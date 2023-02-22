'use strict';

const assert = require('assert');
const typeforce = require('typeforce');

const debugLib = require('debug');
const {sleep, arrayEquals} = require('../utils');
const types = require('../types');
const Tick = require('tick-tock');

const debugNode = debugLib('node:app');
const debugBlock = debugLib('node:block');
const debugMsg = debugLib('node:messages');
const debugMsgFull = debugLib('node:messages:full');

const PEER_RECONNECT_TIMER_NAME = 'peerReconnectTimer';
const MEMPOOL_REANNOUNCE_TIMER_NAME = 'mempoolTimer';

function createPeerKey(peer) {
    return peer.address + peer.port;
}

module.exports = (factory, factoryOptions) => {
    const {
        Contract,
        Transport,
        Messages,
        Constants,
        Peer,
        PeerManager,
        Storage,
        Crypto,
        Mempool,
        Inventory,
        RPC,
        Application,
        Transaction,
        Block,
        PatchDB,
        Coins,
        PendingBlocksManager,
        MainDag,
        BlockInfo,
        Mutex,
        RequestCache,
        TxReceipt,
        UTXO
    } = factory;
    const {
        MsgCommon,
        MsgVersion,
        PeerInfo,
        MsgAddr,
        MsgReject,
        MsgTx,
        MsgBlock,
        MsgInv,
        MsgGetData,
        MsgGetBlocks
    } = Messages;
    const {MSG_VERSION, MSG_VERACK, MSG_GET_ADDR, MSG_ADDR, MSG_REJECT, MSG_GET_MEMPOOL} = Constants.messageTypes;

    return class Node {
        constructor(options) {

            // mix in factory (common for all instance) options
            options = {
                ...factoryOptions,
                ...options
            };

            this._nMinConnections = Constants.MIN_PEERS;

            const {arrSeedAddresses, arrDnsSeeds, nMaxPeers, queryTimeout, workerSuspended, networkSuspended} = options;

            this._workerSuspended = workerSuspended;
            this._networkSuspended = networkSuspended;
            this._msecOffset = 0;

            this._mutex = new Mutex();
            this._storage = new Storage({...options, mutex: this._mutex});

            // nonce for MsgVersion to detect connection to self (use crypto.randomBytes + readIn32LE) ?
            this._nonce = parseInt(Math.random() * 100000);

            this._arrSeedAddresses = arrSeedAddresses || [];
            this._arrDnsSeeds = arrDnsSeeds || Constants.DNS_SEED;

            this._queryTimeout = queryTimeout || Constants.PEER_QUERY_TIMEOUT;

            // create mempool
            this._mempool = new Mempool(options);

            this._mapBlocksToExec = new Map();
            this._mapUnknownBlocks = new Map();
            this._mapBlocksToExec = new Map();
            this._app = new Application(options);

            this._rebuildPromise = this._rebuildBlockDb();
            this._listenPromise = networkSuspended ? Promise.resolve() : this._initNetwork(options);
        }

        _initNetwork(options) {
            this._transport = new Transport(options);
            this._transport.on('connect', this._incomingConnection.bind(this));

            this._reconnectTimer = new Tick(this);
            this._reannounceTimer = new Tick(this);
            this._requestCache = new RequestCache();

            return new Promise(async resolve => {

                // we'll init network after all local tasks are done
                await Promise.all([this._rebuildPromise]);

                await this._transport.listen();

                const {announceAddr, announcePort} = options;
                const address = Transport.strToAddress(announceAddr ? announceAddr : this._transport.myAddress);
                const port = announcePort ? announcePort : this._transport.port;
                this._myPeerInfo = new PeerInfo({
                    capabilities: [
                        {service: Constants.NODE}
                    ],
                    address,
                    port
                });

                this._debugAddress = this._transport.myAddress;

                this._peerManager =
                    new PeerManager({transport: this._transport, storage: this._storage, ...options});

                // TODO: add handler for new peer, to bradcast it to neighbour (connected peers)!
                this._peerManager.on('message', this._incomingMessage.bind(this));
                debugNode(`(address: "${this._debugAddress}") start listening`);
                this._peerManager.on('disconnect', this._peerDisconnect.bind(this));

                //start RPC
                if (options.rpcAddress) {
                    this._rpc = new RPC(this, options);
                }

                resolve();
            });
        }

        get rpc() {
            return this._rpc;
        }

        get storage() {
            return this._storage;
        }

        get nonce() {
            return this._nonce;
        }

        get networkTime() {
            return Date.now() + this._msecOffset;
        }

        ensureLoaded() {
            return Promise.all([this._listenPromise, this._rebuildPromise]).catch(err => logger.error(err));
        }

        async bootstrap() {
            await this._mergeSeedPeers();

            // will try to load address book
            await this._peerManager.loadPeers();

            // start worker
            if (!this._workerSuspended) setImmediate(this._nodeWorker.bind(this));

            // start connecting to peers (just seed peers! to get network topology
            // the rest will be connected by _reconnectPeers)
            const arrSeedPeers = this._arrSeedAddresses.map(
                strAddr => this._peerManager.addPeer(
                    new PeerInfo({
                        address: Transport.strToAddress(factory.Transport.toIpV6Address(strAddr)),
                        capabilities: [{service: Constants.NODE}]
                    })
                )
            );
            await this._connectToPeers(arrSeedPeers);

            this._reconnectTimer.setInterval(
                PEER_RECONNECT_TIMER_NAME,
                this._reconnectPeers,
                Constants.PEER_RECONNECT_INTERVAL
            );

            this._reannounceTimer .setInterval(
                MEMPOOL_REANNOUNCE_TIMER_NAME,
                this._reannounceMempool,
                Constants.MEMPOOL_REANNOUNCE_INTERVAL
            );
        }

        async _connectToPeers(peers) {
            for (let peer of peers) {
                try {
                    if (peer.disconnected) await this._connectToPeer(peer);
                    await peer.pushMessage(this._createMsgVersion());
                    await peer.loaded();
                } catch (e) {
                    debugNode(e.message);
                }
            }
        }

        /**
         *
         * @param {Peer} peer!
         * @return {Promise<*>}
         * @private
         */
        async _connectToPeer(peer) {
            debugNode(`(address: "${this._debugAddress}") connecting to "${peer.address}"`);
            if (!peer.isBanned()) await peer.connect(this._transport.listenAddress);
            debugNode(`(address: "${this._debugAddress}") CONNECTED to "${peer.address}"`);
        }

        /**
         * Add DNS peers into this._arrSeedAddresses
         *
         * @return {Promise<void>}
         * @private
         */
        async _mergeSeedPeers() {
            if (this._arrDnsSeeds && this._arrDnsSeeds.length) {
                const arrDnsPeers = await this._queryDnsRecords(this._arrDnsSeeds);
                this._arrSeedAddresses = this._arrSeedAddresses.concat(arrDnsPeers);
            }
        }

        /**
         * Query DNS records for peerAddresses
         *
         * @param {Array} arrDnsSeeds
         * @param {String} arrDnsSeeds[0] - like 'dnsseed.bluematt.me'
         * @return {Promise<Array>} - array of addresses of seed nodes
         * @private
         */
        async _queryDnsRecords(arrDnsSeeds) {
            let arrResult = [];
            const arrPromises = [];
            for (let name of arrDnsSeeds) {
                const prom = Transport.resolveName(name)
                    .then(arrAddresses => {
                        arrResult = arrResult.concat(arrAddresses);
                    })
                    .catch(err => logger.error(err));
                arrPromises.push(prom);
            }
            await Promise.race([Promise.all(arrPromises), sleep(this._queryTimeout)]);
            return arrResult;
        }

        async _incomingConnection(connection) {
            try {

                // TODO: disconnect this peer if we already have Constant.MAX_PEERS (CIL-124)
                this._peerManager.addCandidateConnection(connection);
            } catch (err) {
                debugNode(err);
                connection.close();
            }
        }

        async _peerDisconnect(peer) {
            this._msecOffset -= peer.offsetDelta;
        }

        async _reconnectPeers() {
            if (this._bReconnectInProgress) return;

            this._bReconnectInProgress = true;
            try {
                let bestPeers = this._peerManager.findBestPeers().filter(p => p.disconnected);
                let peers = bestPeers.splice(0, this._nMinConnections - this._peerManager.getConnectedPeers().length);
                await this._connectToPeers(peers);
            } catch (e) {
                debugNode(e.message);
            } finally {
                this._bReconnectInProgress = false;
            }
        }

        /**
         *
         * @param {Peer} peer
         * @param {MessageCommon} message
         * @private
         */
        async _incomingMessage(peer, message) {
            try {

                debugMsg(
                    `(address: "${this._debugAddress}") received message "${message.message}" from "${peer.address}"`);

                if (message.isPong()) {
                    return;
                }

                if (message.isReject()) {
                    const rejectMsg = new MsgReject(message);

                    // connection will be closed by other end
                    logger.log(
                        `(address: "${this._debugAddress}") peer: "${peer.address}" rejected with reason: "${rejectMsg.reason}"`);
                    return;
                }

                if (message.isVersion()) {
                    return await this._handleVersionMessage(peer, message);
                }

                if (message.isVerAck()) {
                    return await this._handleVerackMessage(peer);
                }

                if (!peer.fullyConnected) {
                    logger.error(`Peer "${peer.remoteAddress}" missed version handshake stage`);
                    peer.misbehave(1);
                    return;
                }

                if (message.isGetAddr()) {
                    return await this._handlePeerRequest(peer);
                }
                if (message.isAddr()) {
                    return await this._handlePeerList(peer, message);
                }
                if (message.isGetBlocks()) {
                    return await this._handleGetBlocksMessage(peer, message);
                }
                if (message.isGetMempool()) {
                    return await this._handleGetMempool(peer);
                }
                if (message.isInv()) {
                    return await this._handleInvMessage(peer, message);
                }
                if (message.isGetData()) {
                    return await this._handleGetDataMessage(peer, message);
                }
                if (message.isTx()) {
                    return await this._handleTxMessage(peer, message);
                }
                if (message.isBlock()) {
                    return await this._handleBlockMessage(peer, message);
                }

                throw new Error(`Unhandled message type "${message.message}"`);
            } catch (err) {
                logger.error(`Incoming message. Peer ${peer.address}`, err);

                // TODO: implement state (like bitcoin) to keep misbehave score or penalize on each handler?
                peer.misbehave(1);
            }
        }

        /**
         * Handler for MSG_TX message
         *
         * @param {Peer} peer - peer that send message
         * @param {MessageCommon} message
         * @return {Promise<void>}
         * @private
         */
        async _handleTxMessage(peer, message) {

            // this will check syntactic correctness
            const msgTx = new MsgTx(message);
            const tx = msgTx.tx;
            const strTxHash = tx.hash();

            if (!this._requestCache.isRequested(strTxHash)) {
                logger.log(`Peer ${peer.address} pushed unrequested TX ${strTxHash} to us`);
                peer.misbehave(5);
                return;
            }

            try {
                await this._processReceivedTx(tx);
                await this._informNeighbors(tx, peer);
            } catch (e) {
                logger.error(e, `Bad TX received. Peer ${peer.address}`);
                if (!this._isInitialBlockLoading()) peer.misbehave(5);
                throw e;
            }
        }

        /**
         * Handler for MSG_BLOCK message
         *
         * @param {Peer} peer - peer that send message
         * @param {MessageCommon} message
         * @return {Promise<void>}
         * @private
         */
        async _handleBlockMessage(peer, message) {

            const msg = new MsgBlock(message);
            const block = msg.block;
            debugNode(`Received block ${block.getHash()}`);

            if (!this._requestCache.isRequested(block.getHash())) {
                logger.log(`Peer ${peer.address} pushed unrequested Block ${block.getHash()} to us`);
                peer.misbehave(5);
                return;
            }

            if (this._storage.isBlockBanned(block.hash())) {
                debugNode(`Block ${block.hash()} was banned! Discarding`);
                return;
            }

            // since we building DAG, it's faster than check storage
            if (await this._isBlockKnown(block.hash())) {
                debugNode(`Block ${block.hash()} already known!`);
                return;
            }
            try {
                await this._handleArrivedBlock(block, peer);
            } catch (e) {
                await this._blockBad(block);
                logger.error(e);
                if (peer) peer.misbehave(10);
                throw e;
            }
        }

        async _handleArrivedBlock(block, peer) {
            const lock = await this._mutex.acquire(['blockReceived', 'inventory']);

            try {

                // TODO: verify rihgt before exec. BC if it's block for new concilium,
                //  we could have concilium definition in pending blocks also!
                await this._verifyBlock(block, false);

                // store it in DAG & disk
                await this._blockInFlight(block);

                this._requestCache.done(block.getHash());
                this._mapUnknownBlocks.delete(block.getHash());
            } finally {
                this._mutex.release(lock);
            }
            await this._processBlock(block, peer);
        }

        /**
         * Handler for MSG_INV message
         * Send MSG_GET_DATA for unknown hashes
         *
         * @param {Peer} peer - peer that send message
         * @param {MessageCommon} message
         * @return {Promise<void>}
         * @private
         */
        async _handleInvMessage(peer, message) {
            const invMsg = new MsgInv(message);
            const invToRequest = new Inventory();

            const lock = await this._mutex.acquire(['inventory']);
            try {
                let nBlockToRequest = 0;
                for (let objVector of invMsg.inventory.vector) {

                    // we already requested it (from another peer), so let's skip it
                    if (this._requestCache.isRequested(objVector.hash)) continue;

                    let bShouldRequest = false;
                    if (objVector.type === Constants.INV_TX) {

                        bShouldRequest = !this._mempool.hasTx(objVector.hash) &&
                                         !this._isInitialBlockLoading();
                        if (bShouldRequest) {
                            try {
                                await this._storage.getUtxo(objVector.hash, true).catch();
                                bShouldRequest = false;
                            } catch (e) {
                            }
                        }
                    } else if (objVector.type === Constants.INV_BLOCK) {
                        const strHash=objVector.hash.toString('hex');
                        const bBlockKnown=await this._isBlockKnown(strHash);
                        bShouldRequest = !this._storage.isBlockBanned(strHash) &&
                                         !this._requestCache.isRequested(strHash) &&
                                         !bBlockKnown;
                        if (bShouldRequest) nBlockToRequest++;

                        // i.e. we store it, it somehow missed dag
                        if(bBlockKnown && this._mainDag.getBlockInfo(strHash)) {
                            this._queueBlockExec(strHash, peer);
                        }
                    }

                    if (bShouldRequest) {
                        invToRequest.addVector(objVector);
                        this._requestCache.request(objVector.hash);
                        debugMsgFull(`Will request "${objVector.hash.toString('hex')}" from "${peer.address}"`);
                    }
                }

                // inventory could contain TXns
                if (invToRequest.vector.length) {
                    const msgGetData = new MsgGetData();
                    msgGetData.inventory = invToRequest;
                    debugMsg(
                        `(address: "${this._debugAddress}") requesting ${invToRequest.vector.length} hashes from "${peer.address}"`);
                    await peer.pushMessage(msgGetData);
                }

                // was it reponse to MSG_GET_BLOCKS ?
                if (peer.isGetBlocksSent()) {
                    if (nBlockToRequest > 1) {

                        // so we should resend MSG_GET_BLOCKS later
                        peer.markAsPossiblyAhead();
                    } else {
                        peer.markAsEven();

                        if (nBlockToRequest === 1) {
                            peer.singleBlockRequested();
                        } else if (!this._isInitialBlockLoading()) {

                            // we requested blocks from equal peer and receive NOTHING new, now we can request his mempool
                            const msgGetMempool = new MsgCommon();
                            msgGetMempool.getMempoolMessage = true;
                            debugMsg(
                                `(address: "${this._debugAddress}") sending "${MSG_GET_MEMPOOL}" to "${peer.address}"`);
                            await peer.pushMessage(msgGetMempool);
                        }
                    }
                    peer.doneGetBlocks();
                }
            } catch (e) {
                throw e;
            } finally {
                this._mutex.release(lock);
            }
        }

        /**
         * Handler for MSG_GET_BLOCKS message.
         * Send MSG_INV for further blocks (if we have it)
         *
         * @param {Peer} peer - peer that send message
         * @param {MessageCommon} message - it contains hashes of LAST FINAL blocks!
         * @return {Promise<void>}
         * @private
         */
        async _handleGetBlocksMessage(peer, message) {

            // we'r empty. we have nothing to share with party
            if (!this._mainDag.order) return;

            const msg = new MsgGetBlocks(message);
            const inventory = new Inventory();

            for (let hash of this._getBlocksFromLastKnown(msg.arrHashes)) {
                inventory.addBlockHash(hash);
            }
            debugMsg(
                `(address: "${this._debugAddress}") sending ${inventory.vector.length} blocks to "${peer.address}"`);

            const msgInv = new MsgInv();
            msgInv.inventory = inventory;
            debugMsg(`(address: "${this._debugAddress}") sending "${msgInv.message}" to "${peer.address}"`);
            await peer.pushMessage(msgInv);
        }

        async _handleGetMempool(peer) {
            const inventory = new Inventory();

            const arrLocalTxHashes = this._mempool.getLocalTxnHashes();
            arrLocalTxHashes.forEach(hash => inventory.addTxHash(hash));
            debugMsg(
                `(address: "${this._debugAddress}") sending ${arrLocalTxHashes.length} mempool TXns to "${peer.address}"`);

            const msgInv = new MsgInv();
            msgInv.inventory = inventory;
            if (inventory.vector.length) {
                debugMsg(`(address: "${this._debugAddress}") sending "${msgInv.message}" to "${peer.address}"`);
                await peer.pushMessage(msgInv);
            }
        }

        /**
         * Send MsgInv with local txns hashes
         *
         * @returns {Promise<void>}
         * @private
         */
        async _reannounceMempool(){
            const arrPeers=this._peerManager.getConnectedPeers();
            debugMsg(`(address: "${this._debugAddress}") sending mempool to ${arrPeers.length} neighbours`);
            for(let peer of arrPeers){
                await this._handleGetMempool(peer);
            }
        }

        /**
         * Return Set of hashes that are descendants of arrHashes
         *
         * @param {Array<String>} arrHashes - last known hashes
         * @returns {Set<any>} set of hashes descendants of arrHashes
         * @private
         */
        _getBlocksFromLastKnown(arrHashes) {
            const setBlocksToSend = new Set();

            let arrKnownHashes = arrHashes.reduce((arrResult, hash) => {
                if (this._mainDag.getBlockInfo(hash)) arrResult.push(hash);
                return arrResult;
            }, []);

            if (!arrKnownHashes.length) {

                // we missed at least one of those hashes! so we think peer is at wrong DAG
                // sent our version of DAG starting from Genesis

                // check do we have GENESIS self?
                if (this._mainDag.getBlockInfo(Constants.GENESIS_BLOCK)) {
                    arrKnownHashes = [Constants.GENESIS_BLOCK];

                    // Genesis wouldn't be included (same as all of arrHashes), so add it here
                    setBlocksToSend.add(Constants.GENESIS_BLOCK);
                } else {

                    // no GENESIS - return empty Set
                    return new Set();
                }
            }

            const setKnownHashes = new Set(arrKnownHashes);
            let currentLevel = [];
            arrKnownHashes.forEach(hash => this._mainDag
                .getChildren(hash)
                .filter(strChildHash => this._mainDag.getBlockInfo(strChildHash).getHeight() -
                                        this._mainDag.getBlockInfo(hash).getHeight() === 1)
                .forEach(child => !setKnownHashes.has(child) && currentLevel.push(child)));

            do {
                const setNextLevel = new Set();
                for (let hash of currentLevel) {
                    const biCurrent = this._mainDag.getBlockInfo(hash);
                    this._mainDag
                        .getChildren(hash)
                        .filter(strChildHash => this._mainDag.getBlockInfo(strChildHash).getHeight() -
                                                this._mainDag.getBlockInfo(hash).getHeight() === 1)
                        .forEach(
                            strChildHash => {
                                const biChild = this._mainDag.getBlockInfo(strChildHash);

                                // if we didn't already processed it and it's direct child (height diff === 1) - let's add it
                                // it not direct child - we'll add it when find direct one
                                if (!setBlocksToSend.has(strChildHash) && !setKnownHashes.has(strChildHash)
                                    && biChild.getHeight() - biCurrent.getHeight() === 1) {
                                    setNextLevel.add(strChildHash);
                                }
                            });
                    setBlocksToSend.add(hash);
                    if (setBlocksToSend.size > Constants.MAX_BLOCKS_INV) break;
                }
                currentLevel = [...setNextLevel];

            } while (currentLevel.length && setBlocksToSend.size < Constants.MAX_BLOCKS_INV);

            return setBlocksToSend;
        }

        /**
         * Handler for MSG_GET_DATA message.
         * Send series of MSG_TX + MSG_BLOCK for known hashes
         *
         * @param {Peer} peer - peer that send message
         * @param {MessageCommon} message
         * @return {Promise<void>}
         * @private
         */
        async _handleGetDataMessage(peer, message) {

            // TODO: think about rate limiting here + use bloom filter to prevent leeching?
            const msgGetData = new MsgGetData(message);
            for (let objVector of msgGetData.inventory.vector) {
                try {
                    let msg;
                    if (objVector.type === Constants.INV_TX) {

                        // we allow to request txns only from mempool!
                        const tx = this._mempool.getTx(objVector.hash);
                        msg = new MsgTx(tx);
                    } else if (objVector.type === Constants.INV_BLOCK) {
                        const block = await this._storage.getBlock(objVector.hash);
                        msg = new MsgBlock(block);
                    } else {

                        throw new Error(`Unknown inventory type: ${objVector.type}`);
                    }
                    debugMsg(
                        `(address: "${this._debugAddress}") sending "${msg.message}" with "${objVector.hash.toString(
                            'hex')}" to "${peer.address}"`);
                    await peer.pushMessage(msg);
                } catch (e) {
                    logger.error(`GetDataMessage. Peer ${peer.address}`, e);
//                    peer.misbehave(1);

                    // break loop
                    if (peer.isBanned()) return;
                }
            }
        }

        /**
         * Handler for MSG_VERSION message
         *
         * @param {Peer} peer that send message
         * @param {MessageCommon} message
         * @private
         */
        async _handleVersionMessage(peer, message) {
            message = new MsgVersion(message);
            const _offset = message.msecTime - this.networkTime;

            // check time difference for us and connected peer
            if (Math.abs(_offset) > Constants.TOLERATED_TIME_DIFF) {

                // send REJECT & disconnect
                const reason = `Check your clocks! network time is: ${this.networkTime}`;
                const message = new MsgReject({
                    code: Constants.REJECT_TIMEOFFSET,
                    reason
                });
                debugMsg(
                    `(address: "${this._debugAddress}") sending message "${message.message}" to "${peer.address}"`);
                await peer.pushMessage(message);
                await sleep(1000);
                peer.disconnect(reason);
                return;
            }

            // we connected to self
            if (message.nonce === this._nonce) {
                debugNode('Connection to self detected. Disconnecting');

                this._peerManager.removePeer(peer);
                peer.disconnect('Connection to self detected');
                return;
            }

            // TODO: review version compatibility
            if (message.protocolVersion == Constants.protocolVersion) {

                if (!peer.version) {
                    peer.version = message.protocolVersion;
                } else {

                    // we are already have it's version
                    logger.log(`Version message already received. Peer ${peer.address}`);
                    peer.misbehave(1);
                    return;
                }

                if (peer.inbound) {

                    // very beginning of inbound connection
                    const result = this._peerManager.associatePeer(peer, message.peerInfo);

                    if (result instanceof Peer) {

                        // send own version
                        debugMsg(
                            `(address: "${this._debugAddress}") sending own "${MSG_VERSION}" to "${peer.address}"`);
                        await peer.pushMessage(this._createMsgVersion());
                    } else {

                        // we got an error
                        let reason;
                        if (result === Constants.REJECT_BANNED) {
                            reason = 'You are banned';
                        } else if (result === Constants.REJECT_DUPLICATE) {
                            reason = 'Duplicate connection';
                        } else if (result === Constants.REJECT_RESTRICTED) {
                            reason = 'Have a break';
                        } else {
                            reason = 'Check _peerManager.associatePeer!';
                        }

                        const message = new MsgReject({
                            code: result,
                            reason
                        });
                        debugMsg(
                            `(address: "${this._debugAddress}") sending message "${message.message}" to "${peer.address}"`);
                        await peer.pushMessage(message);
                        await sleep(1000);

                        peer.disconnect(reason);
                        return;
                    }
                } else {
                    peer.updatePeerFromPeerInfo(message.peerInfo);
                    this._peerManager.addPeer(peer, true);
                }

                this._adjustNetworkTime(_offset);
                peer.offsetDelta = _offset / 2;

                const msgVerack = new MsgCommon();
                msgVerack.verAckMessage = true;
                debugMsg(`(address: "${this._debugAddress}") sending "${MSG_VERACK}" to "${peer.address}"`);
                await peer.pushMessage(msgVerack);

            } else {
                const reason = `Has incompatible protocol version ${message.protocolVersion.toString(16)}`;
                debugNode(reason);
                peer.disconnect(reason);
            }
        }

        _adjustNetworkTime(offset) {
            this._msecOffset += offset / 2;
        }

        /**
         * Handler for MSG_VERACK message
         *
         * @param {Peer} peer - peer that send message
         * @return {Promise<void>}
         * @private
         */
        async _handleVerackMessage(peer) {
            if (peer.version) {
                peer.fullyConnected = true;

                // next stage
                const msgGetAddr = this._createGetAddrMessage();
                debugMsg(`(address: "${this._debugAddress}") sending "${MSG_GET_ADDR}" to "${peer.address}"`);
                await peer.pushMessage(msgGetAddr);
            }
        }

        _createGetAddrMessage() {
            const msgGetAddr = new MsgCommon();
            msgGetAddr.getAddrMessage = true;
            return msgGetAddr;
        }

        /**
         * Handler for 'getaddr' message
         *
         * @param {Peer} peer - peer that send message
         * @return {Promise<void>}
         * @private
         */
        async _handlePeerRequest(peer) {

            // TODO: split array longer than Constants.ADDR_MAX_LENGTH into multiple messages
            const arrPeerInfos = this._peerManager
                .filterPeers()
                .map(peer => peer.toObject());

            if (arrPeerInfos.length > Constants.ADDR_MAX_LENGTH) {
                logger.error('Its time to implement multiple addr messages');
            }
            debugMsg(`(address: "${this._debugAddress}") sending "${MSG_ADDR}" of ${arrPeerInfos.length} items`);
            await peer.pushMessage(new MsgAddr({count: arrPeerInfos.length, peers: arrPeerInfos}));
        }

        /**
         * Handler for 'addr message
         *
         * @param {Peer} peer - peer that send message
         * @param {MessageCommon} message
         * @return {Promise<void>}
         * @private
         */
        async _handlePeerList(peer, message) {
            message = new MsgAddr(message);
            for (let peerInfo of message.peers) {

                // don't add own address
                if (this._myPeerInfo.address.equals(PeerInfo.toAddress(peerInfo.address))) continue;

                const newPeer = await this._peerManager.addPeer(peerInfo, false);
                if (newPeer instanceof Peer) {
                    debugNode(`(address: "${this._debugAddress}") added peer "${newPeer.address}" to peerManager`);
                }
            }

            // next stage: request unknown blocks or just GENESIS, if we are at very beginning
            let msg;
            if (Constants.GENESIS_BLOCK && !this._mainDag.getBlockInfo(Constants.GENESIS_BLOCK)) {
                msg = this._createGetDataMsg([Constants.GENESIS_BLOCK]);
                peer.markAsPossiblyAhead();
            } else {
                msg = await this._createGetBlocksMsg();
                debugMsg(`(address: "${this._debugAddress}") sending "${msg.message}" to "${peer.address}"`);
            }
            await peer.pushMessage(msg);

            // TODO: move loadDone after we got all we need from peer
            peer.loadDone = true;
        }

        async _createGetBlocksMsg() {
            const msg = new MsgGetBlocks();
            const arrLastApplied = await this._storage.getLastAppliedBlockHashes();
            const arrTips = this._pendingBlocks.getTips();
            msg.arrHashes = arrTips.length ? arrTips : arrLastApplied;
            return msg;
        }

        _createGetDataMsg(arrBlockHashes) {
            const msg = new MsgGetData();
            const inv = new Inventory();
            arrBlockHashes.forEach(hash => {
                if (!this._requestCache.isRequested(hash)) {
                    inv.addBlockHash(hash);
                    this._requestCache.request(hash);
                }
            });
            msg.inventory = inv;

            return msg;
        }

        _createMsgVersion() {
            return new MsgVersion({
                nonce: this._nonce,
                peerInfo: this._myPeerInfo.data
            });
        }

        /**
         *
         * @param {String} event - event name
         * @param {*} content
         * @return {Promise<void>}
         * @private
         */
        async rpcHandler({event, content}) {

            try {
                switch (event) {
                    case 'getLastBlockByConciliumId':
                        return await this.getLastBlockByConciliumId(content);
                    case 'tx':
                        return await this._acceptLocalTx(content);
                    case 'getContractData':
                        return await this._getContractData(content);
                    case 'txReceipt':
                        return await this._getTxReceipt(content);
                    case 'getBlock':

                        // content is hash
                        return await this._getBlockAndState(content).catch(err => debugNode(err));
                    case 'getTips': {
                        let arrHashes = this._pendingBlocks.getTips();

                        if (!arrHashes || !arrHashes.length) {
                            arrHashes = await this._storage.getLastAppliedBlockHashes();
                        }
                        if (!arrHashes) return [];

                        return await Promise.all(
                            arrHashes.map(async h => await this._getBlockAndState(h).catch(err => debugNode(err)))
                        );
                    }
                    case 'getNext': {
                        let arrChildHashes = this._mainDag.getChildren(content);
                        if (!arrChildHashes || !arrChildHashes.length) {
                            arrChildHashes = this._pendingBlocks.getChildren(content);
                        }
                        if (!arrChildHashes) return [];
                        return await Promise.all(
                            arrChildHashes.map(async h => await this._getBlockAndState(h).catch(err => debugNode(err)))
                        );
                    }
                    case 'getPrev': {
                        let cBlockInfo = this._mainDag.getBlockInfo(content);
                        if (!cBlockInfo) {
                            cBlockInfo = this._pendingBlocks.getBlock(content).blockHeader;
                        }
                        if (!cBlockInfo) return [];
                        return await Promise.all(
                            cBlockInfo.parentHashes.map(
                                async h => await this._getBlockAndState(h.toString('hex')).catch(err => debugNode(err)))
                        );
                    }
                    case 'getTx':
                        return await this._getTxForRpc(content);
                    case 'constantMethodCall':
                        return await this._constantMethodCallRpc(content);
                    case 'getUnspent':
                        const utxo = await this._storage.getUtxo(content);
                        return utxo.toObject();
                    case 'getWitnesses':
                        return await this._getAllWitnesses();
                    case 'getConnectedPeers':
                        return this._peerManager.getConnectedPeers();
                    case 'getBannedPeers':
                        return this._peerManager.getBannedPeers();
                    case 'getMempoolContent':
                        return this._mempool.getContent();
                    default:
                        throw new Error(`Unsupported method ${event}`);
                }
            } catch (e) {
                logger.error('RPC error.', e);
                throw e;
            }
        }

        async getPendingUtxos() {
            await this._ensureBestBlockValid();
            const {patchMerged} = this._objCurrentBestParents;
            return Array.from(patchMerged.getCoins().values());
        }

        async _acceptLocalTx(newTx) {
            newTx.verify();

            const strNewTxHash = newTx.getHash();
            if(this._mempool.hasTx(strNewTxHash)) throw new Error('Tx already in mempool');
            if(this._mempool.isBadTx(strNewTxHash)) throw new Error('Tx already marked as bad');

            // let's check for patch conflicts with other local txns
            try {
                await this._ensureLocalTxnsPatch();

                await this._processReceivedTx(newTx, false);
                const {patchThisTx: patchNewTx} = await this._processTx(undefined, false, newTx);

                // update cache
                this._patchLocalTxns = this._patchLocalTxns.merge(patchNewTx);

                // all merges passed - accept new tx
                this._mempool.addLocalTx(newTx, patchNewTx);

                await this._informNeighbors(newTx);
            } catch (e) {
                logger.error(e);
                this._mempool.storeBadTxHash(strNewTxHash);
                throw new Error(`Tx ${strNewTxHash} is not accepted: ${e.message}`);
            }
        }

        /**
         *
         * @param {Transaction} tx
         * @param {Boolean} bStoreInMempool - should we store it in mempool (false - only for received from RPC txns)
         * @private
         */
        async _processReceivedTx(tx, bStoreInMempool = true) {
            typeforce(types.Transaction, tx);

            const strTxHash = tx.getHash();

            // TODO: check against DB & valid claim here rather slow, consider light checks, now it's heavy strict check
            //  this will check for double spend in pending txns
            //  if something wrong - it will throw error

            if (this._mempool.hasTx(tx.hash())) return;

            try {
                await this._storage.checkTxCollision([strTxHash]);
                await this._validateTxLight(tx);
                if (bStoreInMempool) this._mempool.addTx(tx);
            } catch (e) {
                this._mempool.storeBadTxHash(strTxHash);
                throw e;
            }
        }

        /**
         *
         * @param {PatchDB | undefined} patchForBlock
         * @param {Boolean} isGenesis
         * @param {Transaction} tx
         * @param {Number} amountHas - used only for internal TXNs
         * @return {Promise<{fee, patchThisTx}>} fee and patch for this TX
         * @private
         */
        async _processTx(patchForBlock, isGenesis, tx, amountHas) {
            let patchThisTx = new PatchDB(tx.conciliumId);
            let totalHas = amountHas === undefined ? 0 : amountHas;
            let fee = 0;
            let nFeeSize = 0;
            let nMaxFee;

            const lock = await this._mutex.acquire(['transaction']);
            try {
                let contract;
                const isContract = tx.isContractCreation() ||
                                   !!(contract = await this._getContractByAddr(tx.getContractAddr(), patchForBlock));

                // process moneys
                if (!isGenesis) {
                    const arrTxUtxos = tx.utxos;
                    const patchUtxos = await this._storage.getUtxosPatch(arrTxUtxos);

                    let patchMerged = patchUtxos;
                    if (patchForBlock && patchForBlock.hasUtxos(arrTxUtxos)) {
                        patchMerged = patchForBlock.merge(patchUtxos);
                    }
                    ({totalHas, patch: patchThisTx} = this._app.processTxInputs(tx, patchMerged));

                    // calculate TX size fee. Calculated for every tx, not only for contracts
                    nFeeSize = await this._calculateSizeFee(tx, isGenesis);

                } else {
                    nMaxFee = Number.MAX_SAFE_INTEGER;
                }

                const nOutputInxStart = isContract ? 1 : 0;
                const totalSent = this._app.processPayments(tx, patchThisTx, nOutputInxStart);
                if (!isGenesis) nMaxFee = totalHas - totalSent;

                let nRemainingCoins = nMaxFee - (isContract ? tx.getContractSentAmount() : 0);

                assert(isGenesis || nRemainingCoins > nFeeSize,
                    `Require fee at least ${nFeeSize} but you sent less than fee!`
                );

                // TODO: move it to per output processing. So we could use multiple contract invocation in one TX
                //  it's useful for mass payments, where some of addresses could be contracts!
                if (isContract) {

                    // process contract creation/invocation
                    fee = await this._processContract(
                        isGenesis,
                        contract,
                        tx,
                        patchThisTx,
                        patchForBlock || new PatchDB(),
                        nRemainingCoins,
                        nFeeSize
                    );
                } else {

                    // use all coins for money transfer
                    fee = isGenesis ? 0 : nRemainingCoins;
                }
            } finally {
                this._mutex.release(lock);
            }

            return {fee, patchThisTx};
        }

        /**
         * Get fee ot use one input. Useful to estimate minimal useful UTXO
         *
         * @param {Number} conciliumId
         * @return {Promise<number>}
         * @private
         */
        async _getFeeSizePerInput(conciliumId) {
            const witnessConcilium = await this._storage.getConciliumById(conciliumId);
            const nFeePerKb = witnessConcilium && witnessConcilium.getFeeTxSize() || Constants.fees.TX_FEE;

            // index - 4 bytes,
            // txHash - 32 bytes,
            // claimProof - 65 bytes
            // some protobuff overhead - 3 bytes? so 111 - is good estimate
            // size of one input in Kbytes = 111 / 1024 and it's nearly 0.11
            const nKbytes = 0.11;
            return parseInt(nFeePerKb * nKbytes);
        }

        async _calculateSizeFee(tx, isGenesis = false) {
            if (isGenesis) return 0;

            const witnessConcilium = await this._storage.getConciliumById(tx.conciliumId);
            const nFeePerKb = witnessConcilium && witnessConcilium.getFeeTxSize()
                ? witnessConcilium.getFeeTxSize() : Constants.fees.TX_FEE;
            const nKbytes = tx.getSize() / 1024;

            return parseInt(nFeePerKb * nKbytes);
        }

        async _getFeeContractCreation(tx, isGenesis = false) {
            if (isGenesis) return 0;

            const witnessConcilium = await this._storage.getConciliumById(tx.conciliumId);

            return witnessConcilium && witnessConcilium.getFeeContractCreation()
                ? witnessConcilium.getFeeContractCreation() : Constants.fees.CONTRACT_CREATION_FEE;
        }

        async _getFeeContractInvocatoin(tx, isGenesis = false) {
            if (isGenesis) return 0;

            const witnessConcilium = await this._storage.getConciliumById(tx.conciliumId);
            return witnessConcilium &&
                   witnessConcilium.getFeeContractInvocation()
                ? witnessConcilium.getFeeContractInvocation() : Constants.fees.CONTRACT_INVOCATION_FEE;
        }

        async _getFeeInternalTx(tx, isGenesis = false) {
            if (isGenesis) return 0;

            const witnessConcilium = await this._storage.getConciliumById(tx.conciliumId);
            return witnessConcilium &&
                   witnessConcilium.getFeeInternalTx()
                ? witnessConcilium.getFeeInternalTx() : Constants.fees.INTERNAL_TX_FEE;
        }

        async _getFeeStorage(tx, isGenesis = false) {
            if (isGenesis) return 0;

            const witnessConcilium = await this._storage.getConciliumById(tx.conciliumId);
            return witnessConcilium && witnessConcilium.getFeeStorage()
                ? witnessConcilium.getFeeStorage() : Constants.fees.STORAGE_PER_BYTE_FEE;
        }

        /**
         * Contract creation/invocation tx MUST have zero-index output with code, coins and so on
         * the rest of outputs could have change output(s)
         *
         * @param {Boolean} isGenesis
         * @param {Contract | undefined} contract
         * @param {Transaction} tx
         * @param {PatchDB} patchThisTx
         * @param {PatchDB} patchForBlock - used for nested contracts
         * @param {Number} nMaxCoins - allowed coins for contract exec
         * @param {Number} nFeeSize - fee for TX size, we'll add it here, since TxReceipt will contain sum of all fees
         * @returns {Promise<number>} - fee
         * @private
         */
        async _processContract(isGenesis, contract, tx, patchThisTx, patchForBlock, nMaxCoins, nFeeSize) {
            typeforce(
                typeforce.tuple(
                    typeforce.Boolean, typeforce.oneOf(types.Contract, undefined),
                    types.Transaction, types.Patch,
                    types.Patch, typeforce.Number, typeforce.Number
                ), arguments);

            if (contract && this._isTimeToForkSerializer1()) contract.switchSerializerToJson();

            // contract creation/invocation has 2 types of change:
            // 1st - usual for UTXO just send exceeded coins to self
            // 2nd - not used coins (in/out diff - coinsUsed) as internal TX
            let receipt;

            // global variables for contract
            const environment = {
                contractTx: tx.hash(),
                callerAddress: tx.getTxSignerAddress(),
                value: tx.getContractSentAmount(),

                // we fill it before invocation (from contract)
                contractAddr: undefined,
                balance: 0,
                block: this._processedBlock ? {
                    hash: this._processedBlock.getHash(),
                    timestamp: this._processedBlock.timestamp,
                    height: this._processedBlock.getHeight()
                } : {}
            };

            const nFeeStorage = await this._getFeeStorage(tx, isGenesis);
            const nFeeContractCreation = await this._getFeeContractCreation(tx, isGenesis);
            const nFeeContractInvocation = await this._getFeeContractInvocatoin(tx, isGenesis);
            const nFeeInternalTx = await this._getFeeInternalTx(tx, isGenesis);

            const coinsLimit = nMaxCoins - nFeeSize;

            let status;
            let message;
            let bNewContract;

            const lock = await this._mutex.acquire(['application']);

            try {
                this._app.setupVariables({
                    objFees: {nFeeContractCreation, nFeeContractInvocation, nFeeInternalTx},
                    coinsLimit
                });

                if (!contract) {
                    if (coinsLimit < nFeeContractCreation) {
                        throw new Error(
                            `Tx ${tx.hash()} fee ${coinsLimit} for contract creation less than ${nFeeContractCreation}!`);
                    }

                    // contract creation
                    // address creation should be deterministic (same for all nodes!)
                    const addr = environment.contractAddr = Crypto.getAddress(tx.hash());

                    // prevent contract collision
                    if (await this._storage.getContract(Buffer.from(addr, 'hex'))) {
                        throw new Error('Contract already exists');
                    }

                    contract =
                        await this._app.createContract(tx.getContractCode(), environment, Constants.CONTRACT_V_V8);

                    bNewContract = true;
                } else {
                    if (coinsLimit < nFeeContractInvocation) {
                        throw new Error(
                            `Tx ${tx.hash()} fee ${coinsLimit} for contract invocation less than ${nFeeContractInvocation}!`);
                    }

                    // contract invocation
                    assert(
                        contract.getConciliumId() === tx.conciliumId,
                        `TX wrong conciliumId: "${tx.conciliumId}" != contract conciliumId`
                    );

                    const invocationCode = tx.getContractCode();

                    environment.contractAddr = contract.getStoredAddress();
                    environment.balance = contract.getBalance();

                    this._app.setCallbacks(this._createCallbacksForApp(patchForBlock, patchThisTx, tx.hash()));

                    await this._app.runContract(
                        invocationCode && invocationCode.length ? JSON.parse(tx.getContractCode()) : {},
                        contract,
                        environment
                    );
                }

                const nCoinsUsed = nFeeSize + this._app.coinsSpent() + this._app.getDataDelta() * nFeeStorage;
                if (nCoinsUsed > nMaxCoins) throw new Error('Not enough coins to run contract');

                status = Constants.TX_STATUS_OK;
            } catch (err) {
                logger.error('Error in contract!', err);
                status = Constants.TX_STATUS_FAILED;
                message = err.message ? err.message : err.toString();
            }finally {
                this._mutex.release(lock);
            }

            receipt = new TxReceipt({
                coinsUsed: nFeeSize + this._app.coinsSpent() + this._app.getDataDelta() * nFeeStorage,
                contractAddress: bNewContract ? Buffer.from(contract.getStoredAddress(), 'hex') : undefined,
                status,
                message
            });
            patchThisTx.setReceipt(tx.hash(), receipt);

            let fee = 0;

            // contract could throw, so it could be undefined
            if (contract) {

                if (this._isTimeToForkSerializer3()) contract.dirtyWorkaround();

                if (receipt.isSuccessful()) {
                    if (contract.getConciliumId() === undefined) contract.setConciliumId(tx.conciliumId);
                    patchThisTx.setContract(contract);

                    // increase balance of contract
                    contract.deposit(tx.getContractSentAmount());
                } else if (tx.getContractSentAmount() > 0 && this._isTimeToForkSerializer1()) {

                    // return moneys to change receiver
                    nMaxCoins += tx.getContractSentAmount();
                }
            }

            // send change (not for Genesis)
            if (!isGenesis) {
                if (receipt.getCoinsUsed() > nMaxCoins) {
                    fee = nMaxCoins;
                } else {
                    fee = this._createContractChange(tx, nMaxCoins, patchThisTx, receipt);
                }
            }

            return fee;
        }

        /**
         * Used only for contract invocation
         *
         * @param patchBlock
         * @param patchTx
         * @param strTxHash
         * @returns {createInternalTx, invokeContract}
         * @private
         */
        _createCallbacksForApp(patchBlock, patchTx, strTxHash) {
            typeforce(
                typeforce.tuple(types.Patch, types.Patch, types.Str64),
                arguments
            );

            return {
                sendCoins: this._sendCoins.bind(this, patchTx, strTxHash),
                invokeContract: this._invokeNestedContract.bind(this, patchBlock, patchTx, strTxHash)
            };
        }

        /**
         * Send coins from contract
         * Balance & remainingCoins managed by app.runContract.send
         *
         * @param {Patch} patchTx - this parameter bound in this._createCallbacksForApp
         * @param {String} strTxHash - this parameter bound in this._createCallbacksForApp
         * @param {String} strAddress
         * @param {Number} amount
         * @param {Contract} contract - this parameter bound in this._createCallbacksForApp
         * @private
         */
        _sendCoins(patchTx, strTxHash, strAddress, amount, contract) {
            typeforce(typeforce.tuple(
                    types.Patch, types.Str64, types.Address, typeforce.Number, types.Contract),
                arguments
            );

            if (contract.getBalance() < amount) throw new Error('Not enough funds for "send"');

            if (amount === 0) return;
            const internalUtxo = this._createInternalTx(patchTx, strAddress, amount, strTxHash);

            // it's some sorta fake receipt, it will be overridden (or "merged") by original receipt
            const receipt = new TxReceipt({status: Constants.TX_STATUS_OK});
            receipt.addInternalUtxo(internalUtxo);
            patchTx.setReceipt(strTxHash, receipt);

            contract.withdraw(amount);
        }

        /**
         *
         * @param {PatchDB} patchBlock - this parameter bound in this._createCallbacksForApp
         * @param {PatchDB} patchTx - this parameter bound in this._createCallbacksForApp
         * @param {String} strTxHash - this parameter bound in this._createCallbacksForApp
         * @param {String} strAddress - contract address to call
         * @param {Object} objParams - {method, arrArguments, context, coinsLimit, environment, objFees}
         * @param {Contract} contract - this parameter bound in this._createCallbacksForApp
         * @returns {Promise<{success: *, fee: *}>}
         * @private
         */
        async _invokeNestedContract(patchBlock, patchTx, strTxHash, strAddress, objParams, contract) {
            typeforce(
                typeforce.tuple(types.Patch, types.Patch, types.Str64, types.Address, typeforce.Object, types.Contract),
                arguments
            );

            const {method, arrArguments, context, coinsLimit, environment, objFees} = objParams;
            typeforce(
                typeforce.tuple(typeforce.String, typeforce.Array, typeforce.Number),
                [method, arrArguments, coinsLimit]
            );

            const cNestedContract = await this._getContractByAddr(strAddress, patchBlock);
            if (!cNestedContract) throw new Error('Contract not found!');

            if (this._isTimeToForkSerializer2()) {
                cNestedContract.switchSerializerToJson();
            }

            // context set - it's delegatecall, proxy contract
            if (context) cNestedContract.proxyContract(contract);

            const newEnv = {
                ...environment,
                contractAddr: cNestedContract.getStoredAddress(),
                balance: cNestedContract.getBalance()
            };

            const result = await this._app.runContract(
                {method, arrArguments},
                cNestedContract,
                newEnv,
                context
            );

            if (this._isTimeToForkSerializer3()) {
                cNestedContract.dirtyWorkaround();
            }

            patchTx.setContract(cNestedContract);

            return result;
        }

        /**
         * first try to get contract from patch and then to load contract data from storage
         *
         * @param {Buffer | String} contractAddr
         * @param {PatchDB} patchForBlock
         * @returns {Promise<void>}
         * @private
         */
        async _getContractByAddr(contractAddr, patchForBlock) {
            if (!contractAddr) return undefined;

            typeforce(types.Address, contractAddr);

            const buffContractAddr = Buffer.isBuffer(contractAddr) ? contractAddr : Buffer.from(contractAddr, 'hex');
            let contract;

            if (patchForBlock) {
                contract = patchForBlock.getContract(buffContractAddr);
            }

            return contract ? contract.clone() : await this._storage.getContract(buffContractAddr);
        }

        /**
         * Broadcast MSG_INV to connected nodes
         * TODO: implement cache in _peerManager to combine multiple hashes in one inv to save bandwidth & CPU
         *
         * @param {Transaction | Block} item
         * @param {Peer | undefined} peerReceived - received from (to exclude)
         * @param {Number| undefined} nCount - we'll send at most to nCount neighbours
         * @private
         */
        _informNeighbors(item, peerReceived, nCount) {
            const inv = new Inventory();
            item instanceof Transaction ? inv.addTx(item) : inv.addBlock(item);
            const msgInv = new MsgInv(inv);
            debugNode(`(address: "${this._debugAddress}") Informing neighbors about new item ${item.hash()}`);
            this._peerManager.broadcastToConnected('fullyConnected', msgInv, peerReceived, nCount);
        }

        /**
         * Process block:
         * - verify
         * - run Application for each tx
         * - return patch (or null) that could be applied to storage
         *
         * @param {Block} block
         * @returns {PatchDB | null}
         * @private
         */
        async _execBlock(block) {
            const isGenesis = this.isGenesisBlock(block);

            // double check: whether we already processed this block?
            if (this._isBlockExecuted(block.getHash())) {
                debugNode(`Trying to process ${block.getHash()} more than one time!`);
                return null;
            }

            // check for correct block height
            if (!isGenesis) this._checkHeight(block);

            let patchState = await this._pendingBlocks.mergePatches(block.parentHashes);
            patchState.setConciliumId(block.conciliumId);

            let blockFees = 0;
            const blockTxns = block.txns;

            // should start from 1, because coinbase tx need different processing
            for (let i = 1; i < blockTxns.length; i++) {
                const tx = new Transaction(blockTxns[i]);
                assert(tx.conciliumId === block.conciliumId, `Tx ${tx.getHash()} conciliumId differ from block's one`);
                const {fee, patchThisTx} = await this._processTx(patchState, isGenesis, tx);
                blockFees += fee;
                patchState = patchState.merge(patchThisTx, true);
            }

            // process coinbase tx
            if (!isGenesis) {
                await this._processBlockCoinbaseTX(block, blockFees, patchState);
            }

            debugNode(`Block ${block.getHash()} being executed`);
            return patchState;
        }

        /**
         *
         * @param {Block} block
         * @param {Number} blockFees - sum of block TXns fees
         * @param {PatchDB} patchState - patch to add coins
         * @private
         */
        async _processBlockCoinbaseTX(block, blockFees, patchState) {
            const coinbase = new Transaction(block.txns[0]);
            await this._storage.checkTxCollision([coinbase.getHash()]);
            if (!this.isGenesisBlock(block)) coinbase.verifyCoinbase(blockFees);
            const coins = coinbase.getOutCoins();
            for (let i = 0; i < coins.length; i++) {

                // we'll store only non zero outputs to minimise disk usage
                if (coins[i].getAmount() !== 0) patchState.createCoins(coinbase.hash(), i, coins[i]);
            }
        }

        async _acceptBlock(block, patchState) {

            debugNode(`Block ${block.getHash()} accepted`);

            // save block to graph of pending blocks
            await this._pendingBlocks.addBlock(block, patchState);

            const arrStrHashes = block.getTxHashes();

            // invalidate cache
            this._patchLocalTxns = undefined;
            this._mempool.removeForBlock(arrStrHashes);

            // check for finality
            await this._processFinalityResults(
                await this._pendingBlocks.checkFinality(block.getHash(), await this._storage.getConciliumsCount())
            );

            // store pending blocks (for restore state after node restart)
            await this._storage.updatePendingBlocks(this._pendingBlocks.getAllHashes());
        }

        async _processFinalityResults(result) {
            if (!result) return;
            const {
                patchToApply,
                setStableBlocks,
                setBlocksToRollback,
                arrTopStable
            } = result;

            logger.log(`Blocks ${Array.from(setStableBlocks.keys())} are stable now`);

            await this._updateLastAppliedBlocks(arrTopStable);

            let nHeightMax = 0;
            for (let hash of setStableBlocks) {
                const bi = this._mainDag.getBlockInfo(hash);
                if (bi.getHeight() > nHeightMax) nHeightMax = bi.getHeight();
                bi.markAsFinal();
                this._mainDag.setBlockInfo(bi);
                await this._storage.saveBlockInfo(bi);
            }

            await this._storage.applyPatch(patchToApply, nHeightMax);

            // revalidate local TXns. it affects only local TXns, so it doesn't duplicate
            // validation in _unwindBlock
            this._patchLocalTxns = undefined;
            await this._ensureLocalTxnsPatch();

            for (let blockHash of setBlocksToRollback) {
                await this._unwindBlock(await this._storage.getBlock(blockHash));
            }
            await this._storage.removeBadBlocks(setBlocksToRollback);

            if (this._rpc) {
                this._rpc.informWsSubscribersStableBlocks(Array.from(setStableBlocks.keys()));
            }
        }

        async _updateLastAppliedBlocks(arrTopStable) {
            const arrPrevTopStableBlocks = await this._storage.getLastAppliedBlockHashes();
            const mapPrevConciliumIdHash = new Map();
            arrPrevTopStableBlocks.forEach(hash => {
                const cBlockInfo = this._mainDag.getBlockInfo(hash);
                mapPrevConciliumIdHash.set(cBlockInfo.getConciliumId(), hash);
            });

            const mapNewConciliumIdHash = new Map();
            arrTopStable.forEach(hash => {
                const cBlockInfo = this._mainDag.getBlockInfo(hash);
                mapNewConciliumIdHash.set(cBlockInfo.getConciliumId(), hash);
            });

            const arrNewLastApplied = [];

            const nConciliumCount = await this._storage.getConciliumsCount();
            for (let i = 0; i <= nConciliumCount; i++) {
                const hash = mapNewConciliumIdHash.get(i) || mapPrevConciliumIdHash.get(i);

                // concilium could be created, but still no final blocks
                if (hash) arrNewLastApplied.push(hash);
            }

            await this._storage.updateLastAppliedBlocks(arrNewLastApplied);

            this._createPseudoRandomSeed(arrNewLastApplied);
        }

        /**
         * Simple deterministic algorithm For seeding some pseudo random value
         *
         * @param {Array <String>} arrLastStableBlockHashes
         * @private
         */
        _createPseudoRandomSeed(arrLastStableBlockHashes) {
            const lowestHash = arrLastStableBlockHashes.reduce((strLowest, strCurrent) => {
                return strLowest < strCurrent ? strLowest : strCurrent;
            }, 'z');

            const buffHash = Buffer.from(lowestHash, 'hex');
            let seed = 0;
            for (let [, val] of buffHash.entries()) {
                seed += val;
            }
            return seed;
        }

        /**
         * post hook
         *
         * @param {Block} block
         * @returns {Promise<void>}
         * @private
         */
        async _postAcceptBlock(block) {
            logger.log(
                `Block ${block.hash()}. ConciliumId: ${block.conciliumId}. With ${block.txns.length} TXns and parents ${block.parentHashes} was accepted`
            );

            this._objCurrentBestParents = undefined;

            if (this._rpc) {
                const blockAndState = await this._getBlockAndState(block.hash()).catch(err => debugNode(err));
                this._rpc.informWsSubscribersNewBlock(blockAndState);
            }
        }

        isGenesisBlock(block) {
            return block.getHash() === Constants.GENESIS_BLOCK;
        }

        /**
         * Throws error
         * semantically validate block (should have parents, signatures and so on)
         *
         * @param {Block} block
         * @param {Boolean} checkSignatures - whether to check block signatures (used for witness)
         * @private
         */
        async _verifyBlock(block, checkSignatures = true) {
            const isGenesis = this.isGenesisBlock(block);

            // we create Genesis manually, so we sure that it's valid
            if (isGenesis) return;

            block.verify(checkSignatures);

            // we can't check height here, so we'll check it upon execution

            // signatures
            if (checkSignatures && !isGenesis) await this._verifyBlockSignatures(block);

            // TX collision
            await this._storage.checkTxCollision(block.getTxHashes());
        }

        /**
         * Ok, if all block signatures (it's number equals to concilium quorum) matches pubKeys
         *
         * @param {Blob} block
         * @returns {Promise<void>}
         * @private
         */
        async _verifyBlockSignatures(block) {
            const buffBlockHash = Buffer.from(block.hash(), 'hex');

            const witnessConciliumDefinition = await this._storage.getConciliumById(block.conciliumId);
            assert(witnessConciliumDefinition, `Unknown conciliumId: ${block.conciliumId}`);
            const arrStrAddresses = witnessConciliumDefinition.getAddresses(false);
            let gatheredWeight = 0;

            for (let sig of block.signatures) {
                const strAddress = Crypto.getAddress(Crypto.recoverPubKey(buffBlockHash, sig));
                assert(
                    ~arrStrAddresses.findIndex(addr => strAddress === addr),
                    `Bad signature for block ${block.hash()}!`
                );
                gatheredWeight += witnessConciliumDefinition.getWitnessWeight(strAddress);
            }

            if (gatheredWeight < witnessConciliumDefinition.getQuorum()) {
                throw new Error('Not enough signatures for block!');
            }
        }

        /**
         * Build DAG of all known blocks! The rest of blocks will be added upon processing INV requests
         *
         * @param {Array} arrLastStableHashes - hashes of all stable blocks
         * @param {Array} arrPedingBlocksHashes - hashes of all pending blocks
         */
        async _buildMainDag(arrLastStableHashes, arrPedingBlocksHashes) {
            this._mainDag = new MainDag();

            // if we have only one concilium - all blocks becomes stable, and no pending!
            // so we need to start from stables
            let arrCurrentLevel = arrPedingBlocksHashes && arrPedingBlocksHashes.length
                ? arrPedingBlocksHashes
                : arrLastStableHashes;
            while (arrCurrentLevel.length) {
                const setNextLevel = new Set();
                for (let hash of arrCurrentLevel) {
                    debugNode(`Added ${hash} into dag`);

                    // we already processed this block
                    if (this._mainDag.getBlockInfo(hash)) continue;

                    let bi = await this._storage.getBlockInfo(hash);
                    if (!bi) throw new Error('_buildMainDag: Found missed blocks!');
                    if (bi.isBad()) throw new Error(`_buildMainDag: found bad block ${hash} in final DAG!`);

                    await this._mainDag.addBlock(bi);

                    for (let parentHash of bi.parentHashes) {
                        if (!this._mainDag.getBlockInfo(parentHash)) setNextLevel.add(parentHash);
                    }
                }

                // Do we reach GENESIS?
                if (arrCurrentLevel.length === 1 && arrCurrentLevel[0] === Constants.GENESIS_BLOCK) break;

                // not yet
                arrCurrentLevel = [...setNextLevel.values()];
            }
        }

        /**
         * Used at startup to rebuild DAG of pending blocks
         *
         * @param {Array} arrLastStableHashes - hashes of LAST stable blocks
         * @param {Array} arrPendingBlocksHashes - hashes of all pending blocks
         * @returns {Promise<void>}
         */
        async _rebuildPending(arrLastStableHashes, arrPendingBlocksHashes) {
            const setStable = new Set(arrLastStableHashes);
            this._pendingBlocks = new PendingBlocksManager({
                mutex: this._mutex,
                arrTopStable: arrLastStableHashes
            });

            const mapBlocks = new Map();
            const setPatches = new Set();
            for (let hash of arrPendingBlocksHashes) {

                // Somtimes we have hash in both: pending & stable blocks (unexpected shutdown)?
                if (setStable.has(hash)) continue;

                hash = hash.toString('hex');
                let bi = this._mainDag.getBlockInfo(hash);
                if (!bi) bi = await this._storage.getBlockInfo(hash);
                if (!bi) throw new Error('rebuildPending. Found missed blocks!');
                if (bi.isBad()) throw new Error(`rebuildPending: found bad block ${hash} in DAG!`);
                mapBlocks.set(hash, await this._storage.getBlock(hash));
            }

            const runBlock = async (hash) => {

                // are we already executed this block
                if (!mapBlocks.get(hash) || setPatches.has(hash)) return;

                const block = mapBlocks.get(hash);
                for (let parent of block.parentHashes) {
                    if (!setPatches.has(parent)) await runBlock(parent);
                }
                this._processedBlock = block;
                const patchBlock = await this._execBlock(block);

                await this._pendingBlocks.addBlock(block, patchBlock);

                setPatches.add(hash);
                this._processedBlock = undefined;
            };

            for (let hash of arrPendingBlocksHashes) {
                await runBlock(hash);
            }

            if (mapBlocks.size !== setPatches.size) throw new Error('rebuildPending. Failed to process all blocks!');
        }

        async _blockBad(blockOrBlockInfo) {
            typeforce(typeforce.oneOf(types.BlockInfo, types.Block), blockOrBlockInfo);

            const blockInfo = blockOrBlockInfo instanceof Block
                ? new BlockInfo(blockOrBlockInfo.header)
                : blockOrBlockInfo;

            blockInfo.markAsBad();
            await this._storeBlockAndInfo(undefined, blockInfo, false);
        }

        async _blockInFlight(block, bOnlyDag = false) {
            debugNode(`Block "${block.getHash()}" stored`);

            const blockInfo = new BlockInfo(block.header);
            blockInfo.markAsInFlight();
            await this._storeBlockAndInfo(block, blockInfo, bOnlyDag);
        }

        _isBlockExecuted(hash) {
            const blockInfo = this._mainDag.getBlockInfo(hash);
            return (blockInfo && blockInfo.isFinal()) || this._pendingBlocks.hasBlock(hash);
        }

        async _isBlockKnown(hash) {
            const blockInfo = this._mainDag.getBlockInfo(hash);
            return blockInfo || await this._storage.hasBlock(hash);
        }

        async _couldBeResurrected(hash) {
            const blockInfo = this._mainDag.getBlockInfo(hash);
            return !blockInfo && await this._storage.hasBlock(hash);
        }

        /**
         * Depending of BlockInfo flag - store block & it's info in _mainDag & _storage
         *
         * @param {Block | undefined} block
         * @param {BlockInfo} blockInfo
         * @param {Boolean} bOnlyDag - store only in DAG
         * @private
         */
        async _storeBlockAndInfo(block, blockInfo, bOnlyDag) {
            typeforce(typeforce.tuple(typeforce.oneOf(types.Block, undefined), types.BlockInfo), arguments);

            await this._mainDag.addBlock(blockInfo);
            if (bOnlyDag) return;

            if (blockInfo.isBad()) {

                const storedBI = await this._storage.getBlockInfo(blockInfo.getHash()).catch(err => debugNode(err));
                if (storedBI && !storedBI.isBad()) {

                    // rewrite it's blockInfo
                    await this._storage.saveBlockInfo(blockInfo);

                    // remove block (it was marked as good block)
                    await this._storage.removeBlock(blockInfo.getHash());
                } else {

                    // we don't store entire of bad blocks, but store its headers (to prevent processing it again)
                    await this._storage.saveBlockInfo(blockInfo);
                }
            } else {

                // save block, and it's info
                await this._storage.saveBlock(block, blockInfo).catch(err => debugNode(err));
            }
        }

        /**
         * Check was parents executed?
         *
         * @param {Block | BlockInfo} block
         * @return {Promise<boolean || Set>}
         * @private
         */
        _canExecuteBlock(block) {
            if (this.isGenesisBlock(block)) return true;

            for (let hash of block.parentHashes) {
                let blockInfo = this._mainDag.getBlockInfo(hash);

                // parent is bad
                if (blockInfo && blockInfo.isBad()) {
                    throw new Error(`Block ${block.getHash()} refer to bad parent ${hash}`);
                }

                // parent is good!
                if ((blockInfo && blockInfo.isFinal()) || this._pendingBlocks.hasBlock(hash)) continue;

                return false;
            }
            return true;
        }

        /**
         * Block failed to become FINAL, let's unwind it
         *
         * @param {Block} block
         * @private
         */
        async _unwindBlock(block) {
            logger.log(`(address: "${this._debugAddress}") Unwinding txns from block: "${block.getHash()}"`);

            // skip coinbase
            for (let i = 1; i < block.txns.length; i++) {
                await this._processReceivedTx(new Transaction(block.txns[i]), true).catch(err => {});
            }

            try {
                await this._pendingBlocks.removeBlock(block.getHash());
                await this._mainDag.removeBlock(block.getHash());
            } catch (e) {}
        }

        /**
         * SIGINT & SIGTERM handlers
         * @private
         */
        gracefulShutdown() {

            // TODO: implement flushing all in memory data to disk
            this._peerManager.saveAllPeers().then(_ => {
                logger.log('Shutting down');
                process.exit(0);
            });
        }

        /**
         *
         * @param {PatchDB} patch
         * @param {Buffer | String} receiver
         * @param {Number} amount
         * @param {String} strHash
         * @returns {UTXO} - new UTXO
         * @private
         */
        _createInternalTx(patch, receiver, amount, strHash) {
            typeforce(typeforce.tuple(types.Address, typeforce.Number, types.Str64), [receiver, amount, strHash]);

            assert(amount > 0, 'Internal TX with non positive amount!');
            receiver = Buffer.isBuffer(receiver) ? receiver : Buffer.from(receiver, 'hex');

            const coins = new Coins(amount, receiver);
            const txHash = Crypto.createHash(strHash + patch.getNonce());
            const utxo = new UTXO({txHash});
            utxo.addCoins(0, coins);
            patch.setUtxo(utxo);

            return utxo;
        }

        /**
         *
         * @param {Transaction} tx
         * @param {Number} maxFee
         * @param {PatchDB} patch
         * @param {TxReceipt} receipt
         * @returns {Number} - fee
         * @private
         */
        _createContractChange(tx, maxFee, patch, receipt) {
            let fee = receipt.getCoinsUsed();

            assert(maxFee - fee >= 0, '_createContractChange. We spent more than have!');

            // no changeReceiver? ok - no change. all coins become goes to witness!
            const addrChangeReceiver = tx.getContractChangeReceiver();
            if (!addrChangeReceiver || !addrChangeReceiver.length) return maxFee - fee;

            if (Buffer.isBuffer(addrChangeReceiver)) {

                // something left? let's create change
                if (maxFee - fee !== 0) {
                    const changeUtxo = this._createInternalTx(
                        patch,
                        tx.getContractChangeReceiver(),
                        maxFee - fee,
                        tx.getHash()
                    );
                    receipt.addInternalUtxo(changeUtxo);
                }

                // receipt changed by ref, no need to add it to patch
            }

            return fee;
        }

        /**
         * Clean and rebuild DB (UTXO) from block storage
         */
        reIndex() {

        }

        async _rebuildBlockDb() {
            await this._storage.ready();

            const nRebuildStarted = Date.now();

            const arrPendingBlocksHashes = await this._storage.getPendingBlockHashes();
            const arrLastStableHashes = await this._storage.getLastAppliedBlockHashes();

            await this._buildMainDag(arrLastStableHashes, arrPendingBlocksHashes);
            await this._rebuildPending(arrLastStableHashes, arrPendingBlocksHashes);

            debugNode(`Rebuild took ${Date.now() - nRebuildStarted} msec.`);

            this._mempool.loadLocalTxnsFromDisk();
            await this._ensureLocalTxnsPatch();
        }

        async _nodeWorker() {
            await this._blockProcessor().catch(err => logger.error(err));
            await sleep(1000);
            return setImmediate(this._nodeWorker.bind(this));
        }

        /**
         * Main worker that will be restarted periodically
         *
         * _mapBlocksToExec is map of hash => peer (that sent us a block)
         * @returns {Promise<void>}
         * @private
         */
        async _blockProcessor() {
            if (this._isBusyWithExec()) return;

            if (this._mapBlocksToExec.size) {
                debugBlock(`Block processor started. ${this._mapBlocksToExec.size} blocks awaiting to exec`);

                for (let [hash, peer] of this._mapBlocksToExec) {
                    let blockOrInfo = this._mainDag.getBlockInfo(hash);
                    if (!blockOrInfo) {

                        // we have no block in DAG, but possibly have it in storage
                        const block = await this._storage.getBlock(hash).catch(err => debugBlock(err));
                        if (block) await this._blockInFlight(block, true);
                        blockOrInfo = block;
                    }

                    try {
                        if (!blockOrInfo || (blockOrInfo.isBad && blockOrInfo.isBad())) {
                            throw new Error(`Block ${hash} is not found or bad`);
                        }
                        await this._processBlock(blockOrInfo, peer);
                    } catch (e) {
                        logger.error(e);
                        if (blockOrInfo) await this._blockBad(blockOrInfo);
                    } finally {
                        debugBlock(`Removing block ${hash} from BlocksToExec`);
                        this._mapBlocksToExec.delete(hash);
                    }
                }
            } else if (this._requestCache.isEmpty()) {
                await this._queryPeerForRestOfBlocks();
            }

            if (this._mapUnknownBlocks.size) {
                await this._requestUnknownBlocks();
            }
        }

        /**
         *
         * @param {Block | BlockInfo} block
         * @param {Peer} peer
         * @returns {Promise<void>}
         * @private
         */
        async _processBlock(block, peer) {
            typeforce(typeforce.oneOf(types.Block, types.BlockInfo), block);

            debugBlock(`Attempting to exec block "${block.getHash()}"`);

            if (this._canExecuteBlock(block)) {
                if (!this._isBlockExecuted(block.getHash())) {
                    await this._blockProcessorExecBlock(block instanceof Block ? block : block.getHash(), peer);

                    const arrChildrenHashes = this._mainDag.getChildren(block.getHash());
                    for (let hash of arrChildrenHashes) {
                        this._queueBlockExec(hash, peer);
                    }
                }
            } else {
                this._queueBlockExec(block.getHash(), peer);
                const {arrToRequest, arrToExec} = await this._blockProcessorProcessParents(block);
                arrToRequest
                    .filter(hash => !this._storage.isBlockBanned(hash))
                    .forEach(hash => this._mapUnknownBlocks.set(hash, peer));
                arrToExec.forEach(hash => this._queueBlockExec(hash, peer));
            }
        }

        _queueBlockExec(hash, peer) {
            debugBlock(`Adding block ${hash} from BlocksToExec`);

            const blockInfo = this._mainDag.getBlockInfo(hash);
            if (blockInfo && blockInfo.isBad()) return;

            this._mapBlocksToExec.set(hash, peer);
        }

        async _blockProcessorProcessParents(blockInfo) {
            typeforce(typeforce.oneOf(types.Block, types.BlockInfo), blockInfo);

            const arrToRequest = [];
            const arrToExec = [];
            for (let parentHash of blockInfo.parentHashes) {

                // if we didn't queue it for exec & we don't have it yet
                if (!this._mapBlocksToExec.has(parentHash) && !await this._isBlockKnown(parentHash)) {
                    arrToRequest.push(parentHash);
                } else {
                    if (!this._isBlockExecuted(parentHash)) {
                        arrToExec.push(parentHash);
                    }
                }
            }

            return {arrToRequest, arrToExec};
        }

        async _blockProcessorExecBlock(blockOrHash, peer) {
            typeforce(typeforce.oneOf(types.Hash256bit, types.Block), blockOrHash);

            const block = blockOrHash instanceof Block ? blockOrHash : await this._storage.getBlock(blockOrHash);

            debugBlock(`Executing block "${block.getHash()}"`);

            const lock = await this._mutex.acquire(['blockExec', block.getHash()]);
            this._processedBlock = block;
            try {
                const patchState = await this._execBlock(block);
                if (patchState && !this._isBlockExecuted(block.getHash())) {
                    await this._acceptBlock(block, patchState);
                    await this._postAcceptBlock(block);
                    if (!this._networkSuspended && !this._isInitialBlockLoading()) this._informNeighbors(block, peer);
                }
            } catch (e) {
                logger.error(`Failed to execute "${block.hash()}"`, e);
                await this._blockBad(block);
                peer.misbehave(10);
            } finally {
                this._mutex.release(lock);
                this._processedBlock = undefined;
            }
        }

        async _queryPeerForRestOfBlocks() {
            if (!this._isInitialBlockLoading()) return;
            const msg = await this._createGetBlocksMsg();

            const arrConnectedPeers = this._peerManager.getConnectedPeers();
            for (let peer of arrConnectedPeers) {
                if (peer.isAhead() && !peer.isGetBlocksSent()) {
                    debugMsg(`(address: "${this._debugAddress}") sending "${msg.message}" to "${peer.address}"`);
                    await peer.pushMessage(msg);
                }
            }
        }

        async _sendMsgGetDataToPeers(mapPeerBlocks) {
            const arrConnectedPeers = this._peerManager.getConnectedPeers();
            if (!arrConnectedPeers || !arrConnectedPeers.length) return;

            for (let [key, setBlocks] of mapPeerBlocks) {
                if (!setBlocks.size) continue;

                const arrHashesToRequest = [...setBlocks].slice(0, Constants.MAX_BLOCKS_INV);
                const msg = this._createGetDataMsg(arrHashesToRequest);
                if (!msg.inventory.vector.length) return;

                const foundPeer = arrConnectedPeers.find(p => createPeerKey(p) === key);
                const peer = foundPeer ? foundPeer : arrConnectedPeers[0];

                msg.inventory.vector.forEach(v => this._requestCache.request(v.hash));

                if (peer && !peer.disconnected) {
                    peer.singleBlockRequested();

                    debugMsgFull(`Requesting ${msg.inventory.vector.length} blocks from ${peer.address}`);
                    await peer.pushMessage(msg);
                }
            }
        }

        async _requestUnknownBlocks() {

            // request all unknown blocks
            const {mapPeerBlocks, mapPeerAhead} = this._createMapBlockPeer();
            for (let peer of mapPeerAhead.values()) {
                await this._queryPeerForRestOfBlocks(peer);
            }
            await this._sendMsgGetDataToPeers(mapPeerBlocks);
        }

        /**
         * Which hashes of this._mapUnknownBlocks should be queried from which peer
         * Or if peer seems to be ahead of us - send MsgGetBlocks
         *
         * @returns {Map, Map} mapPeerBlocks: {peerKey => Set of hashes}, mapPeerAhead {peerKey => peer}
         * @private
         */
        _createMapBlockPeer() {
            const mapPeerBlocks = new Map();
            const mapPeerAhead = new Map();

            for (let [hash, peer] of this._mapUnknownBlocks) {
                if (this._requestCache.isRequested(hash) || this._mainDag.getBlockInfo(hash)) continue;

                const key = createPeerKey(peer);

                // we'll batch request block from this peer
                if (peer.isAhead()) {
                    mapPeerAhead.set(key, peer);
                    continue;
                }

                let setBlocks = mapPeerBlocks.get(key);
                if (!setBlocks) {
                    setBlocks = new Set();
                    mapPeerBlocks.set(key, setBlocks);
                }
                setBlocks.add(hash);
            }
            return {mapPeerBlocks, mapPeerAhead};
        }

        async _getBlockAndState(hash) {
            typeforce(types.Str64, hash);

            const cBlock = await this._storage.getBlock(hash);
            const blockInfo = this._mainDag.getBlockInfo(hash);

            return {block: cBlock, state: blockInfo ? blockInfo.getState() : undefined};
        }

        /**
         *
         * @param {String} strTxHash
         * @returns {Promise<{tx, block, status}>}
         * @private
         */
        async _getTxForRpc(strTxHash) {
            const formResult = (tx, status, block) => {
                return {tx, status, block};
            };

            // look it in mempool first
            if (this._mempool.hasTx(strTxHash)) return formResult(this._mempool.getTx(strTxHash), 'mempool', undefined);

            // look among internal TXns
            const buffSourceTx = await this._storage.findInternalTx(strTxHash);
            if (buffSourceTx) {
                const receipt = await this._storage.getTxReceipt(buffSourceTx);
                const coins = receipt.getCoinsForTx(strTxHash);

                return formResult(
                    {coins: coins.getRawData(), from: buffSourceTx.toString('hex')},
                    'internal',
                    undefined
                );
            }

            // search by tx will work only with --txIndex so let's use that index
            const block = await this._storage.findBlockByTxHash(strTxHash);

            // not found
            if (!block) return formResult(undefined, 'unknown', undefined);

            // find tx in block
            const objTx = block.txns.find(objTx => (new Transaction(objTx)).getHash() === strTxHash);

            // is this block still pending?
            const status = this._pendingBlocks.hasBlock(block.getHash()) ? 'in block' : 'confirmed';

            return formResult(objTx, status, block.getHash());
        }

        async _constantMethodCallRpc({method, arrArguments, contractAddress, completed}) {
            typeforce(
                typeforce.tuple(typeforce.String, typeforce.Array, types.StrAddress),
                [method, arrArguments, contractAddress]
            );

            const lock = await this._mutex.acquire(['transaction', 'application']);
            try {
                let contract = await this._storage.getContract(contractAddress);

                if (!completed) {
                    const pendingContract = this._pendingBlocks.getContract(contractAddress, contract.getConciliumId());
                    if (pendingContract) contract = pendingContract;
                }

                if (!contract) throw new Error(`Contract ${contractAddress} not found`);

                const newEnv = {
                    contractAddr: contract.getStoredAddress(),
                    balance: contract.getBalance()
                };

                const nCoinsDummy = Number.MAX_SAFE_INTEGER;
                this._app.setCallbacks(this._createCallbacksForApp(new PatchDB(), new PatchDB(), '1'.repeat(64)));
                this._app.setupVariables({
                    objFees: { nFeeContractInvocation: nCoinsDummy },
                    nCoinsDummy
                });
                return await this._app.runContract(
                    { method, arrArguments },
                    contract,
                    newEnv,
                    undefined,
                    true
                );
            } finally {
                this._mutex.release(lock);
            }
        }

        /**
         * Height is longest path in DAG
         *
         * @param {Array} arrParentHashes - of strHashes
         * @return {Number}
         * @private
         */
        _calcHeight(arrParentHashes) {
            typeforce(typeforce.arrayOf(types.Hash256bit), arrParentHashes);

            return arrParentHashes.reduce((maxHeight, hash) => {
                const blockInfo = this._mainDag.getBlockInfo(hash);
                return maxHeight > blockInfo.getHeight() ? maxHeight : blockInfo.getHeight();
            }, 0) + 1;
        }

        /**
         *
         * @param {Block} block
         * @private
         */
        _checkHeight(block) {
            const calculatedHeight = this._calcHeight(block.parentHashes);
            assert(calculatedHeight === block.getHeight(),
                `Incorrect height "${calculatedHeight}" were calculated for block ${block.getHash()} (expected ${block.getHeight()}`
            );
        }

        async _getContractData(strContractAddr) {
            typeforce(types.StrAddress, strContractAddr);

            const cont = await this._storage.getContract(
                Buffer.from(strContractAddr, 'hex'));

            return cont.getData();
        }

        async cleanDb() {
            await this._storage.dropAllForReIndex();
        }

        /**
         * Rebuild chainstate from blockDb (reExecute them one more time)
         *
         * @param {String | undefined} strHashToStop - hash of block to stop rebuild. this block also will be executed
         * @returns {Promise<void>}
         */
        async rebuildDb(strHashToStop) {
            this._mainDag = new MainDag();

            for await (let {value} of this._storage.readBlocks()) {
                const block = new factory.Block(value);
                await this._mainDag.addBlock(new BlockInfo(block.header));
            }

            this._queryPeerForRestOfBlocks = this._requestUnknownBlocks = () => {
                logger.error('we have unresolved dependencies! will possibly fail to rebuild DB');
            };

            const originalQueueBlockExec = this._queueBlockExec.bind(this);
            let bStop = Constants.GENESIS_BLOCK === strHashToStop;
            this._queueBlockExec = async (hash, peer) => {
                if (bStop) return;
                if (hash === strHashToStop) bStop = true;
                const blockInfo = this._mainDag.getBlockInfo(hash);
                this._storage.saveBlockInfo(blockInfo).catch(err => logger.error(err));
                originalQueueBlockExec(hash, peer);
            };

            const genesis = this._mainDag.getBlockInfo(Constants.GENESIS_BLOCK);
            assert(genesis, 'No Genesis found');
            this._mapBlocksToExec.set(genesis.getHash(), undefined);

            await this._blockProcessor();
        }

        async _getAllWitnesses() {
            return this._peerManager.filterPeers({service: Constants.WITNESS}, true);
        }

        async getLastBlockByConciliumId({nConciliumId, bStable}) {
            let maxHeight = 0;
            let strBestHash;

            if (!bStable) {
                this._pendingBlocks.forEach(hash => {
                    const {blockHeader} = this._pendingBlocks.getBlock(hash);
                    const blockInfo = new factory.BlockInfo(blockHeader);
                    if (blockInfo.getHeight() > maxHeight && blockInfo.getConciliumId() === nConciliumId) {
                        maxHeight = blockInfo.getHeight();
                        strBestHash = hash;
                    }
                });
                if (strBestHash) return strBestHash;
            }

            const arrLastStable = await this._storage.getLastAppliedBlockHashes();
            const [stableBi] = arrLastStable
                .map(hash => this._mainDag.getBlockInfo(hash))
                .filter(bi => bi.getConciliumId() === nConciliumId);

            return stableBi ? stableBi.getHash() : undefined;
        }

        async _validateTxLight(tx) {
            tx.verify();
            const patchUtxos = await this._storage.getUtxosPatch(tx.utxos);

            await this._ensureBestBlockValid();
            let {patchMerged} = this._objCurrentBestParents;

            const {totalHas} = this._app.processTxInputs(tx, patchMerged.merge(patchUtxos));
            const sizeFee = await this._calculateSizeFee(tx, false);
            assert(totalHas >= tx.amountOut() + sizeFee, `Require fee at least ${sizeFee}`);
        }

        async _ensureBestBlockValid() {
            if (this._objCurrentBestParents) return;
            this._objCurrentBestParents = await this._pendingBlocks.getBestParents();
        }

        /**
         * Get patch of all non-conflicting txns and store it as cache
         * Invalidate when purging txns from mempool
         *
         * @private
         */
        async _ensureLocalTxnsPatch() {
            if (this._patchLocalTxns) return this._patchLocalTxns;

            let patchMerged = new PatchDB();

            for (let {strTxHash, patchTx} of this._mempool.getLocalTxnsPatches()) {

                // NO patches - means mempool just loaded, we need to exec all stored local txns
                if (!patchTx) {
                    const localTx = this._mempool.getTx(strTxHash);

                    try {
                        const objResult = await this._processTx(undefined, false, localTx);
                        const patchThisTx = objResult.patchThisTx;

                        // store it back with patch
                        this._mempool.addLocalTx(localTx, patchThisTx);
                        patchTx = patchThisTx;
                    } catch (e) {
                        debugNode(`Removing TX ${strTxHash} conflicting with current chainstate`);
                        this._mempool.removeTxns([strTxHash]);
                    }
                }

                // if we were unable to process TX patchTx will be undefined
                if (patchTx) patchMerged = patchMerged.merge(patchTx);
            }

            this._patchLocalTxns = patchMerged;
        }

        getMutexLocks(){
            return this._mutex.getLocks();
        }

        /**
         * BlockA behind BlockB ? > 0
         *
         * @param strHashBlockA
         * @param strHashBlockB
         * @return {number}
         */
        sortBlocks(strHashBlockA, strHashBlockB) {
            return this._mainDag.getBlockHeight(strHashBlockA) - this._mainDag.getBlockHeight(strHashBlockB);
        }

        /**
         * Will search receipt in patch of local txns or pending blocks
         *
         * @param {String} strTxHash
         * @return {TxReceipt}
         * @private
         */
        async _getTxReceipt(strTxHash) {
            await this._ensureLocalTxnsPatch();
            let receipt = this._patchLocalTxns ? this._patchLocalTxns.getReceipt(strTxHash) : undefined;
            if (receipt) return receipt;

            await this._ensureBestBlockValid();
            const patch = this._objCurrentBestParents ? this._objCurrentBestParents.patchMerged : undefined;
            if (patch && patch.getReceipt(strTxHash)) return patch.getReceipt(strTxHash);

            return await this._storage.getTxReceipt(strTxHash);
        }

        _isBusyWithExec() {
            return this._mutex.isLocked('blockExec');
        }

        _isInitialBlockLoading() {
            const arrConnectedPeers = this._peerManager.getConnectedPeers();
            return arrConnectedPeers.find(peer => peer.isAhead());
        }

        _isTimeToForkSerializer1() {
            return !this._processedBlock ||
                   (this._processedBlock && this._processedBlock.getHeight() >= Constants.forks.HEIGHT_FORK_SERIALIZER);
        }

        _isTimeToForkSerializer2() {
            return !this._processedBlock ||
                   (this._processedBlock && this._processedBlock.getHeight() >=
                    Constants.forks.HEIGHT_FORK_SERIALIZER_FIX2);
        }

        _isTimeToForkSerializer3() {
            return !this._processedBlock ||
                   (this._processedBlock && this._processedBlock.getHeight() <
                    Constants.forks.HEIGHT_FORK_SERIALIZER_FIX3);
        }
    };
};

