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

function createPeerKey(peer) {
    return peer.address + peer.port;
}

module.exports = (factory, factoryOptions) => {
    const {
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
        LocalTxns
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
    const {MSG_VERSION, MSG_VERACK, MSG_GET_ADDR, MSG_ADDR, MSG_REJECT} = Constants.messageTypes;

    return class Node {
        constructor(options) {

            // mix in factory (common for all instance) options
            options = {
                ...factoryOptions,
                ...options
            };

            const {arrSeedAddresses, arrDnsSeeds, nMaxPeers, queryTimeout, workerSuspended} = options;

            this._mutex = new Mutex();

            this._storage = new Storage({...options, mutex: this._mutex});

            // nonce for MsgVersion to detect connection to self (use crypto.randomBytes + readIn32LE) ?
            this._nonce = parseInt(Math.random() * 100000);

            this._arrSeedAddresses = arrSeedAddresses || [];
            this._arrDnsSeeds = arrDnsSeeds || Constants.DNS_SEED;
            this._workerSuspended = workerSuspended;
            this._queryTimeout = queryTimeout || Constants.PEER_QUERY_TIMEOUT;

            // create mempool
            this._mempool = new Mempool(options);

            // create storage for own TXns and load saved TXns
            this._localTxns = new LocalTxns(options);

            this._transport = new Transport(options);
            this._transport.on('connect', this._incomingConnection.bind(this));
            this._listenPromise = this._transport.listen()
                .then(() => {

                    this._myPeerInfo = new PeerInfo({
                        capabilities: [
                            {service: Constants.NODE}
                        ],
                        address: Transport.strToAddress(this._transport.myAddress),
                        port: this._transport.port
                    });

                    // used only for debugging purpose. Feel free to remove
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
                })
                .catch(err => console.error(err));

            this._mapBlocksToExec = new Map();
            this._mapUnknownBlocks = new Map();
            this._mapBlocksToExec = new Map();
            this._app = new Application(options);

            this._rebuildPromise = this._rebuildBlockDb();

            this._msecOffset = 0;

            this._reconnectTimer = new Tick(this);
            this._requestCache = new RequestCache();
        }

        get rpc() {
            return this._rpc;
        }

        get nonce() {
            return this._nonce;
        }

        get networkTime() {
            return Date.now() + this._msecOffset;
        }

        ensureLoaded() {
            return Promise.all([this._listenPromise, this._rebuildPromise]);
        }

        async bootstrap() {
            await this._mergeSeedPeers();

            // will try to load address book
            const arrPeers = await this._peerManager.loadPeers();
            if (arrPeers.length) {

                // success, we have address book - let's deal with them
                arrPeers.forEach(peer => this._peerManager.addPeer(peer, true));
            } else {

                // empty address book. let's ask seeds for peer list
                this._arrSeedAddresses.forEach(strAddr =>
                    this._peerManager.addPeer(new PeerInfo({
                        address: Transport.strToAddress(factory.Transport.toIpV6Address(strAddr)),
                        capabilities: [{service: Constants.NODE}]
                    })), true);
            }

            // start worker
            if (!this._workerSuspended) setImmediate(this._nodeWorker.bind(this));

            // start connecting to peers
            // TODO: make it not greedy, because we should keep slots for incoming connections! i.e. twice less than _nMaxPeers
            const arrBestPeers = this._peerManager.findBestPeers();
            await this._connectToPeers(arrBestPeers);

            this._reconnectTimer.setInterval(
                Constants.PEER_RECONNECT_TIMER,
                this._reconnectPeers,
                Constants.PEER_RECONNECT_INTERVAL
            );
        }

        /**
         *
         * @param {Peer} peer!
         * @return {Promise<*>}
         * @private
         */
        async _connectToPeer(peer) {
            debugNode(`(address: "${this._debugAddress}") connecting to "${peer.address}"`);
            await peer.connect();
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
                this._peerManager.addCandidateConnection(connection);
            } catch (err) {
                logger.error(err);
                connection.close();
            }
        }

        async _peerDisconnect(peer) {
            this._msecOffset -= peer.offsetDelta;
        }

        async _connectToPeers(peers) {
            for (let peer of peers) {
                try {
                    if (peer.disconnected) await this._connectToPeer(peer);
                    await peer.pushMessage(this._createMsgVersion());
                    await peer.loaded();
                } catch (e) {
                    logger.error(e.message);
                }
            }
        }

        async _reconnectPeers() {
            let bestPeers = this._peerManager.findBestPeers().filter(p => p.disconnected);
            let peers = bestPeers.splice(0, Constants.MIN_PEERS - this._peerManager.getConnectedPeers().length);
            await this._connectToPeers(peers);
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
                logger.error(err, `Incoming message. Peer ${peer.address}`);

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
            } catch (e) {
                logger.error(e, `Bad TX received. Peer ${peer.address}`);
                peer.misbehave(5);
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

            // since we building DAG, it's faster than check storage
            if (this._mainDag.getBlockInfo(block.hash())) {
                logger.error(`Block ${block.hash()} already known!`);
                return;
            }

            const lock = await this._mutex.acquire([`blockReceived`]);
            try {
                await this._verifyBlock(block);

                this._mapUnknownBlocks.delete(block.getHash());

                // store it in DAG & disk
                await this._blockInFlight(block);
                await this._processBlock(block, peer);
            } catch (e) {
                await this._blockBad(block);
                logger.error(e);
                peer.misbehave(10);
                throw e;
            } finally {
                this._mutex.release(lock);
            }
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
                let nBlocksInMsg = 0;
                for (let objVector of invMsg.inventory.vector) {

                    // we already requested it (from another peer), so let's skip it
                    if (this._requestCache.isRequested(objVector.hash)) continue;

                    let bShouldRequest = false;
                    if (objVector.type === Constants.INV_TX) {

                        // TODO: more checks? for example search this hash in UTXOs?
                        bShouldRequest = !this._mempool.hasTx(objVector.hash);
                    } else if (objVector.type === Constants.INV_BLOCK) {
                        nBlocksInMsg++;
                        bShouldRequest = !this._requestCache.isRequested(objVector.hash) &&
                                         !await this._storage.hasBlock(objVector.hash);
                    }

                    if (bShouldRequest) {
                        invToRequest.addVector(objVector);
                        this._requestCache.request(objVector.hash);
                        debugMsgFull(`Requesting "${objVector.hash.toString('hex')}" from "${peer.address}"`);
                    }
                }

                if (invToRequest.vector.length) {
                    const msgGetData = new MsgGetData();
                    msgGetData.inventory = invToRequest;
                    debugMsg(
                        `(address: "${this._debugAddress}") requesting ${invToRequest.vector.length} hashes from "${peer.address}"`);
                    await peer.pushMessage(msgGetData);
                }

                // if peer expose us more than MAX_BLOCKS_INV - it seems it is ahead
                // so we should resend MSG_GET_BLOCKS later
                if (nBlocksInMsg >= Constants.MAX_BLOCKS_INV) {
                    peer.markAsPossiblyAhead();
                } else {
                    peer.markAsEven();
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

            // append local TXns to this inv
            const arrLocalTxHashes = this._localTxns.getAllTxnHashes();
            arrLocalTxHashes.forEach(hash => inventory.addTxHash(hash));
            debugMsg(
                `(address: "${this._debugAddress}") sending ${arrLocalTxHashes.length} local TXns to "${peer.address}"`);

            const msgInv = new MsgInv();
            msgInv.inventory = inventory;
            if (inventory.vector.length) {
                debugMsg(`(address: "${this._debugAddress}") sending "${msgInv.message}" to "${peer.address}"`);
                await peer.pushMessage(msgInv);
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
                .forEach(child => !setKnownHashes.has(child) && currentLevel.push(child)));

            do {
                const setNextLevel = new Set();
                for (let hash of currentLevel) {

                    this._mainDag.getChildren(hash).forEach(
                        child => {

                            // we already processed it
                            if (!setBlocksToSend.has(child) && !setKnownHashes.has(child)) setNextLevel.add(child);
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
                    //                    logger.error(e.message);
                    logger.error(e, `GetDataMessage. Peer ${peer.address}`);
                    peer.misbehave(5);

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
            if (message.protocolVersion >= Constants.protocolVersion) {

                if (!peer.version) {
                    peer.version = message.protocolVersion;
                } else {

                    // we are already have it's version
                    logger.log(`Version message already received. Peer ${peer.address}`);
                    peer.misbehave(1);
                    return;
                }

                // very beginning of inbound connection
                if (peer.inbound) {
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
                }

                this._adjustNetworkTime(_offset);
                peer.offsetDelta = _offset / 2;

                const msgVerack = new MsgCommon();
                msgVerack.verAckMessage = true;
                debugMsg(`(address: "${this._debugAddress}") sending "${MSG_VERACK}" to "${peer.address}"`);
                await peer.pushMessage(msgVerack);

            } else {
                const reason = `Has incompatible protocol version ${message.protocolVersion}`;
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

            // add address of this node (it's absent in peerManager)
            arrPeerInfos.push(this._myPeerInfo.data);
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

            // next stage: request unknown blocks
            const msg = await this._createGetBlocksMsg();
            debugMsg(`(address: "${this._debugAddress}") sending "${msg.message}" to "${peer.address}"`);
            await peer.pushMessage(msg);

            // TODO: move loadDone after we got all we need from peer
            peer.loadDone = true;
        }

        async _createGetBlocksMsg() {
            const msg = new MsgGetBlocks();
            msg.arrHashes = await this._storage.getLastAppliedBlockHashes();
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
                    case 'tx':
                        await this._processReceivedTx(content);
                        this._localTxns.addTx(content);
                        break;
                    case 'txReceipt':
                        return await this._storage.getTxReceipt(content);
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
                    case 'walletListUnspent': {
                        const {strAddress, bStableOnly = false} = content;

                        let arrPendingUtxos = [];
                        if (!bStableOnly) {
                            const {patchMerged} = await this._pendingBlocks.getBestParents();
                            arrPendingUtxos = Array.from(patchMerged.getCoins().values());
                        }
                        const arrStableUtxos = await this._storage.walletListUnspent(strAddress);

                        return {arrStableUtxos, arrPendingUtxos};
                    }
                    case 'watchAddress': {
                        const {strAddress, bReindex} = content;
                        await this._storage.walletWatchAddress(strAddress);
                        if (bReindex) this._storage.walletReIndex();
                        break;
                    }
                    case 'getWallets':
                        return await this._storage.getWallets();
                        break;
                    default:
                        throw new Error(`Unsupported method ${event}`);
                }
            } catch (e) {
                logger.error('RPC error.', e);
                throw e;
            }
        }

        /**
         *
         * @param {Transaction} tx
         * @returns {Promise<void>}
         * @private
         */
        async _processReceivedTx(tx) {
            typeforce(types.Transaction, tx);

            // TODO: check against DB & valid claim here rather slow, consider light checks, now it's heavy strict check
            // this will check for double spend in pending txns
            // if something wrong - it will throw error

            if (this._mempool.hasTx(tx.hash())) return;

            await this._storage.checkTxCollision([tx.hash()]);
            await this._processTx(undefined, false, tx);
            this._mempool.addTx(tx);

            await this._informNeighbors(tx);
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
            let nFeeTx;

            const lock = await this._mutex.acquire(['transaction']);
            try {

                // process input (for regular block only)
                if (!isGenesis) {
                    tx.verify();
                    const patchUtxos = await this._storage.getUtxosPatch(tx.utxos);
                    const patchMerged = patchForBlock ? patchForBlock.merge(patchUtxos) : patchUtxos;
                    ({totalHas, patch: patchThisTx} = this._app.processTxInputs(tx, patchMerged));
                }

                // calculate TX size fee
                nFeeTx = await this._calculateSizeFee(tx);
                const nRemainingCoins = totalHas - nFeeTx;
                if (!isGenesis) {
                    assert(nRemainingCoins > 0, `Require fee at least ${nFeeTx} but you sent only ${totalHas}`);
                }

                let totalSent = 0;
                let contract;

                // TODO: move it to per output processing. So we could use multiple contract invocation in one TX
                //  it's useful for mass payments, where some of addresses could be contracts!
                if (tx.isContractCreation() ||
                    (contract = await this._getContractByAddr(tx.getContractAddr(), patchForBlock))
                ) {

                    // process contract creation/invocation
                    fee = await this._processContract(isGenesis, contract, tx, patchThisTx, patchForBlock,
                        nRemainingCoins, nFeeTx
                    );
                    const receipt = patchThisTx.getReceipt(tx.getHash());
                    if (!receipt || !receipt.isSuccessful()) {
                        throw new Error(`Tx ${tx.hash()} contract invocation failed`);
                    }
                } else {

                    // regular payment
                    totalSent = this._app.processPayments(tx, patchThisTx);
                    if (!isGenesis) {
                        fee = nRemainingCoins - totalSent;
                        if (fee < 0 || fee < nFeeTx) {
                            throw new Error(`Tx ${tx.hash()} fee ${fee} too small! Expected ${nFeeTx}`);
                        }
                    }
                }
            } finally {
                this._mutex.release(lock);
            }

            // add TX fee size
            fee += nFeeTx;

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

        async _calculateSizeFee(tx) {
            const witnessConcilium = await this._storage.getConciliumById(tx.conciliumId);
            const nFeePerKb = witnessConcilium && witnessConcilium.getFeeTxSize() || Constants.fees.TX_FEE;
            const nKbytes = tx.getSize() / 1024;
            return parseInt(nFeePerKb * nKbytes);
        }

        async _getFeeContractCreation(tx) {
            const witnessConcilium = await this._storage.getConciliumById(tx.conciliumId);
            return witnessConcilium && witnessConcilium.getContractCreationFee() ||
                   Constants.fees.CONTRACT_CREATION_FEE;
        }

        async _getFeeContractInvocatoin(tx) {
            const witnessConcilium = await this._storage.getConciliumById(tx.conciliumId);
            return witnessConcilium && witnessConcilium.getContractInvocationFee() ||
                   Constants.fees.CONTRACT_INVOCATION_FEE;
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
         * @param {Number} nCoinsIn - sum of all inputs coins
         * @returns {Promise<number>}
         * @private
         */
        async _processContract(isGenesis, contract, tx, patchThisTx, patchForBlock, nCoinsIn) {
            let fee = 0;

            // contract creation/invocation has 2 types of change:
            // 1st - usual for UTXO just send exceeded coins to self
            // 2nd - not used coins (in/out diff - coinsUsed) as internal TX
            let receipt;

            // global variables for contract
            const environment = {
                contractTx: tx.hash(),
                callerAddress: tx.getTxSignerAddress(),

                // we fill it before invocation (from contract)
                contractAddr: undefined,
                balance: 0,
                // TODO Fix it (when witness creates block this is unknown!)
//                block: this._processedBlock ? {
//                    hash: this._processedBlock.getHash(),
//                    timestamp: this._processedBlock.timestamp
//                } : {}
                block: {
                    hash: 'stub',
                    timestamp: 'stub'
                }
            };

            // get max contract fee
            let coinsLimit;
            if (!isGenesis) {
                const totalSent = this._app.processPayments(tx, patchThisTx, 1);
                coinsLimit = nCoinsIn - totalSent;
            } else {
                coinsLimit = Number.MAX_SAFE_INTEGER;
            }

            if (!contract) {

                const nFeeContractCreation = await this._getFeeContractCreation(tx);
                if (coinsLimit < nFeeContractCreation) {
                    throw new Error(
                        `Tx ${tx.hash()} fee ${coinsLimit} for contract creation less than ${nFeeContractCreation}!`);
                }

                // contract creation
                // address creation should be deterministic (same for all nodes!)
                const addr = environment.contractAddr = Crypto.getAddress(tx.hash());

                // prevent contract collision
                if (await this._storage.getContract(Buffer.from(addr, 'hex'))) {
                    throw new Errror('Contract already exists');
                }

                ({receipt, contract} =
                    await this._app.createContract(coinsLimit, tx.getContractCode(), environment));
            } else {

                const nFeeContractInvocation = await this._getFeeContractInvocatoin(tx);
                if (coinsLimit < nFeeContractInvocation) {
                    throw new Error(
                        `Tx ${tx.hash()} fee ${coinsLimit} for contract invocation less than ${nFeeContractInvocation}!`);
                }

                // contract invocation
                assert(
                    contract.getConciliumId() === tx.conciliumId,
                    `TX conciliumId: "${tx.conciliumId}" != contract conciliumId`
                );

                const invocationCode = tx.getContractCode();

                environment.contractAddr = contract.getStoredAddress();
                environment.balance = contract.getBalance();

                receipt = await this._app.runContract(
                    coinsLimit,
                    invocationCode && invocationCode.length ? JSON.parse(tx.getContractCode()) : {},
                    contract,
                    environment,
                    undefined,
                    this._createCallbacksForApp(patchForBlock, patchThisTx, tx.hash())
                );
            }
            patchThisTx.setReceipt(tx.hash(), receipt);

            // send change (not for Genesis)
            if (!isGenesis) {
                fee = this._createContractChange(tx, coinsLimit, patchThisTx, contract, receipt);
            }

            // contract could throw, so it could be undefined
            if (contract) {
                patchThisTx.setContract(contract);

                // increase balance of contract
                if (receipt.isSuccessful()) contract.deposit(tx.getContractSentAmount());
            }

            return fee;
        }

        _createCallbacksForApp(patchBlock, patchTx, strTxHash) {
            return {
                createInternalTx: this._sendCoins.bind(this, patchTx, strTxHash),
                invokeContract: this._invokeNestedContract.bind(this, patchBlock, patchTx, strTxHash)
            };
        }

        _sendCoins(patchTx, strTxHash, strAddress, amount) {
            typeforce(typeforce.tuple(types.Patch, types.Str64, types.Address, typeforce.Number), arguments);

            if (amount === 0) return;
            const internalTxHash = this._createInternalTx(patchTx, strAddress, amount);

            // it's some sorta fake receipt, it will be overridden (or "merged") by original receipt
            const receipt = new TxReceipt({status: Constants.TX_STATUS_OK});
            receipt.addInternalTx(internalTxHash);
            patchTx.setReceipt(strTxHash, receipt);
        }

        async _invokeNestedContract(patchBlock, patchTx, strTxHash, strAddress, objParams) {
            typeforce(
                typeforce.tuple(types.Patch, types.Patch, types.Str64, types.Address, typeforce.Object),
                arguments
            );

            const {method, arrArguments, context, coinsLimit, environment} = objParams;
            typeforce(
                typeforce.tuple(typeforce.String, typeforce.Array, typeforce.Number),
                [method, arrArguments, coinsLimit]
            );

            const contract = await this._getContractByAddr(strAddress, patchBlock);
            if (!contract) throw new Error('Contract not found!');
            const newEnv = {
                ...environment,
                contractAddr: contract.getStoredAddress(),
                balance: contract.getBalance()
            };
            const receipt = await this._app.runContract(
                coinsLimit,
                {method, arrArguments},
                contract,
                newEnv,
                context,
                this._createCallbacksForApp(patchBlock, patchTx, strTxHash)
            );

            if (receipt.isSuccessful()) {
                patchTx.setReceipt(strTxHash, receipt);
                patchTx.setContract(contract);
            }
            return {success: receipt.isSuccessful(), fee: receipt.getCoinsUsed()};
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
         * @private
         */
        _informNeighbors(item) {
            const inv = new Inventory();
            item instanceof Transaction ? inv.addTx(item) : inv.addBlock(item);
            const msgInv = new MsgInv(inv);
            debugNode(`(address: "${this._debugAddress}") Informing neighbors about new item ${item.hash()}`);
            this._peerManager.broadcastToConnected('fullyConnected', msgInv);
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
            const blockInfoDag = this._mainDag.getBlockInfo(block.getHash());
            if (blockInfoDag && (blockInfoDag.isFinal() || this._pendingBlocks.hasBlock(block.getHash()))) {
                logger.error(`Trying to process ${block.getHash()} more than one time!`);
                return null;
            }

            // check for correct block height
            if (!isGenesis) this._checkHeight(block);

            let patchState = this._pendingBlocks.mergePatches(block.parentHashes);

            let blockFees = 0;
            const blockTxns = block.txns;

            // should start from 1, because coinbase tx need different processing
            for (let i = 1; i < blockTxns.length; i++) {
                patchState.setConciliumId(block.conciliumId);

                const tx = new Transaction(blockTxns[i]);
                const {fee, patchThisTx} = await this._processTx(patchState, isGenesis, tx);
                blockFees += fee;
                patchState = patchState.merge(patchThisTx, true);
            }

            // process coinbase tx
            if (!isGenesis) {
                this._processBlockCoinbaseTX(block, blockFees, patchState);
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
        _processBlockCoinbaseTX(block, blockFees, patchState) {
            const coinbase = new Transaction(block.txns[0]);
            coinbase.verifyCoinbase(blockFees);
            const coins = coinbase.getOutCoins();
            for (let i = 0; i < coins.length; i++) {

                // we'll store only non zero outputs to minimise disk usage
                if (coins[i].getAmount() !== 0) patchState.createCoins(coinbase.hash(), i, coins[i]);
            }
        }

        async _acceptBlock(block, patchState) {

            debugNode(`Block ${block.getHash()} accepted`);

            // save block to graph of pending blocks
            this._pendingBlocks.addBlock(block, patchState);

            const arrStrHashes = block.getTxHashes();
            this._mempool.removeForBlock(arrStrHashes);
            this._localTxns.removeForBlock(arrStrHashes);

            // check for finality
            await this._processFinalityResults(
                await this._pendingBlocks.checkFinality(block.getHash(), await this._storage.getConciliumsCount())
            );

            // store pending blocks (for restore state after node restart)
            await this._storage.updatePendingBlocks(this._pendingBlocks.getAllHashes());

            this._informNeighbors(block);
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

            await this._storage.applyPatch(patchToApply);
            await this._updateLastAppliedBlocks(arrTopStable);

            for (let blockHash of setBlocksToRollback) {
                await this._unwindBlock(await this._storage.getBlock(blockHash));
            }
            await this._storage.removeBadBlocks(setBlocksToRollback);

            for (let hash of setStableBlocks) {
                const bi = this._mainDag.getBlockInfo(hash);
                bi.markAsFinal();
                this._mainDag.setBlockInfo(bi);
                await this._storage.saveBlockInfo(bi);
            }
            if (this._rpc) {
                this._rpc.informWsSubscribersStableBlocks(Array.from(setStableBlocks.keys()));
            }
        }

        async _updateLastAppliedBlocks(arrTopStable) {
            const arrPrevTopStableBlocks = await this._storage.getLastAppliedBlockHashes();
            const mapPrevConciliumIdHash = new Map();
            arrPrevTopStableBlocks.forEach(hash => {
                const cBlockInfo = this._mainDag.getBlockInfo(hash);
                mapPrevConciliumIdHash.set(cBlockInfo.conciliumId(), hash);
            });

            const mapNewConciliumIdHash = new Map();
            arrTopStable.forEach(hash => {
                const cBlockInfo = this._mainDag.getBlockInfo(hash);
                mapNewConciliumIdHash.set(cBlockInfo.conciliumId(), hash);
            });

            const arrNewLastApplied = [];

            const nConciliumCount = await this._storage.getConciliumsCount();
            for (let i = 0; i <= nConciliumCount; i++) {
                const hash = mapNewConciliumIdHash.get(i) || mapPrevConciliumIdHash.get(i);

                // concilium could be created, but still no final blocks
                if (hash) arrNewLastApplied.push(hash);
            }

            await this._storage.updateLastAppliedBlocks(arrNewLastApplied);
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
         * Ok, if all block signatures (number og it equals to concilium quorum) matches delegates pubKeys
         *
         * @param {Blob} block
         * @returns {Promise<void>}
         * @private
         */
        async _verifyBlockSignatures(block) {
            const buffBlockHash = Buffer.from(block.hash(), 'hex');

            const witnessConciliumDefinition = await this._storage.getConciliumById(block.conciliumId);
            assert(witnessConciliumDefinition, `Unknown conciliumId: ${block.conciliumId}`);
            const arrPubKeys = witnessConciliumDefinition.getDelegatesPublicKeys();
            assert(
                block.signatures.length === witnessConciliumDefinition.getQuorum(),
                `Expected ${witnessConciliumDefinition.getQuorum()} signatures, got ${block.signatures.length}`
            );
            for (let sig of block.signatures) {
                const buffPubKey = Buffer.from(Crypto.recoverPubKey(buffBlockHash, sig), 'hex');
                assert(
                    ~arrPubKeys.findIndex(key => buffPubKey.equals(key)),
                    `Bad signature for block ${block.hash()}!`
                );
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

                    this._mainDag.addBlock(bi);

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
            this._pendingBlocks = new PendingBlocksManager(arrLastStableHashes);

            const mapBlocks = new Map();
            const mapPatches = new Map();
            for (let hash of arrPendingBlocksHashes) {
                hash = hash.toString('hex');
                let bi = this._mainDag.getBlockInfo(hash);
                if (!bi) bi = await this._storage.getBlockInfo(hash);
                if (!bi) throw new Error('rebuildPending. Found missed blocks!');
                if (bi.isBad()) throw new Error(`rebuildPending: found bad block ${hash} in DAG!`);
                mapBlocks.set(hash, await this._storage.getBlock(hash));
            }

            const runBlock = async (hash) => {

                // are we already executed this block
                if (!mapBlocks.get(hash) || mapPatches.has(hash)) return;

                const block = mapBlocks.get(hash);
                for (let parent of block.parentHashes) {
                    if (!mapPatches.has(parent)) await runBlock(parent);
                }
                mapPatches.set(hash, await this._execBlock(block));
            };

            for (let hash of arrPendingBlocksHashes) {
                await runBlock(hash);
            }

            if (mapBlocks.size !== mapPatches.size) throw new Error('rebuildPending. Failed to process all blocks!');

            for (let [hash, block] of mapBlocks) {
                this._pendingBlocks.addBlock(block, mapPatches.get(hash));
            }
        }

        async _blockBad(blockOrBlockInfo) {
            typeforce(typeforce.oneOf(types.BlockInfo, types.Block), blockOrBlockInfo);

            const blockInfo = blockOrBlockInfo instanceof Block
                ? new BlockInfo(blockOrBlockInfo.header)
                : blockOrBlockInfo;

            blockInfo.markAsBad();
            await this._storeBlockAndInfo(undefined, blockInfo);
        }

        async _blockInFlight(block) {
            debugNode(`Block "${block.getHash()}" stored`);

            const blockInfo = new BlockInfo(block.header);
            blockInfo.markAsInFlight();
            await this._storeBlockAndInfo(block, blockInfo);
        }

        _isBlockExecuted(hash) {
            const blockInfo = this._mainDag.getBlockInfo(hash);
            return (blockInfo && blockInfo.isFinal()) || this._pendingBlocks.hasBlock(hash);
        }

        async _isBlockKnown(hash) {
            const blockInfo = this._mainDag.getBlockInfo(hash);
            return blockInfo || await this._storage.hasBlock(hash);
        }

        /**
         * Depending of BlockInfo flag - store block & it's info in _mainDag & _storage
         *
         * @param {Block | undefined} block
         * @param {BlockInfo} blockInfo
         * @private
         */
        async _storeBlockAndInfo(block, blockInfo) {
            typeforce(typeforce.tuple(typeforce.oneOf(types.Block, undefined), types.BlockInfo), arguments);

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
            this._mainDag.addBlock(blockInfo);
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

                    // it will be marked as bad in _handleBlockMessage
                    throw new Error(
                        `Block ${block.getHash()} refer to bad parent ${hash}`);
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
            for (let objTx of block.txns) {
                this._mempool.addTx(new Transaction(objTx));
            }
        }

        /**
         * SIGINT & SIGTERM handlers
         * @private
         */
        gracefulShutdown() {

            // TODO: implement flushing all in memory data to disk
            this._peerManager.saveAllPeers().then(_ => {
                console.log('Shutting down');
                process.exit(1);
            });
        }

        /**
         *
         * @param {PatchDB} patch
         * @param {Buffer | String} receiver
         * @param {Number} amount
         * @returns {String} - new internal TX hash
         * @private
         */
        _createInternalTx(patch, receiver, amount) {
            typeforce(typeforce.tuple(types.Address, typeforce.Number), [receiver, amount]);

            assert(amount > 0, 'Internal TX with non positive amount!');
            receiver = Buffer.isBuffer(receiver) ? receiver : Buffer.from(receiver, 'hex');

            const coins = new Coins(amount, receiver);
            const txHash = Crypto.createHash(Crypto.randomBytes(32));
            patch.createCoins(txHash, 0, coins);

            return txHash;
        }

        /**
         *
         * @param {Transaction} tx
         * @param {Number} maxFee
         * @param {PatchDB} patch
         * @param {Contract} contract
         * @param {TxReceipt} receipt
         * @returns {Number} - fee
         * @private
         */
        _createContractChange(tx, maxFee, patch, contract, receipt) {

            // no changeReceiver? ok - no change. all coins become goes to witness!
            const addrChangeReceiver = tx.getContractChangeReceiver();
            if (!addrChangeReceiver || !addrChangeReceiver.length) return maxFee;

            let fee = maxFee;
            assert(maxFee >= fee, 'We spent more than have!');

            if (Buffer.isBuffer(addrChangeReceiver)) {
                fee = receipt.getCoinsUsed();

                if (maxFee - fee !== 0) {
                    const changeTxHash = this._createInternalTx(
                        patch,
                        tx.getContractChangeReceiver(),
                        maxFee - fee
                    );
                    receipt.addInternalTx(changeTxHash);
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
            const arrPendingBlocksHashes = await this._storage.getPendingBlockHashes();
            const arrLastStableHashes = await this._storage.getLastAppliedBlockHashes();

            await this._buildMainDag(arrLastStableHashes, arrPendingBlocksHashes);
            await this._rebuildPending(arrLastStableHashes, arrPendingBlocksHashes);
        }

        async _nodeWorker() {
            await this._blockProcessor().catch(err => console.error(err));
            await sleep(1000);
            return setImmediate(this._nodeWorker.bind(this));
        }

        /**
         * _mapBlocksToExec is map of hash => peer (that sent us a block)
         * @returns {Promise<void>}
         * @private
         */
        async _blockProcessor() {
            if (this._mapBlocksToExec.size) {
                debugBlock(`Block processor started. ${this._mapBlocksToExec.size} blocks awaiting to exec`);

//                const arrReversed=[...this._mapBlocksToExec].reverse();
                for (let [hash, peer] of this._mapBlocksToExec) {
                    let blockOrInfo = this._mainDag.getBlockInfo(hash);
                    if (!blockOrInfo) blockOrInfo = await this._storage.getBlock(hash).catch(err => debugBlock(err));

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

            if (await this._canExecuteBlock(block)) {
                if (!this._isBlockExecuted(block.getHash())) {
                    if (block instanceof Block) {
                        await this._blockProcessorExecBlock(block, peer);
                    } else {
                        await this._blockProcessorExecBlock(block.getHash(), peer);
                    }

                    const arrChildrenHashes = this._mainDag.getChildren(block.getHash());
                    for (let hash of arrChildrenHashes) {
                        this._queueBlockExec(hash, peer);

                        //consume too much memory
//                        await this._processBlock(await this._storage.getBlock(hash));
                    }
                }
            } else {
                this._queueBlockExec(block.getHash(), peer);
                const {arrToRequest, arrToExec} = await this._blockProcessorProcessParents(block);
                arrToRequest.forEach(hash => this._mapUnknownBlocks.set(hash, peer));
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

            const lock = await this._mutex.acquire(['blockExec']);
            try {
                const patchState = await this._execBlock(block);
                await this._acceptBlock(block, patchState);
                await this._postAcceptBlock(block);
                await this._informNeighbors(block);

                this._requestCache.done(block.getHash());
                await this._queryPeerForRestOfBlocks(peer);
            } catch (e) {
                logger.error(`Failed to execute "${block.hash()}"`, e);
                await this._blockBad(block);
                peer.misbehave(10);
            } finally {
                this._mutex.release(lock);
            }
        }

        async _queryPeerForRestOfBlocks(peer) {

            // if peer is ahead (last time reply with MAX blocks) and we got everything already
            // here we could request next portion of blocks
            if (peer.isAhead() && !peer.isGetBlocksSent() && this._requestCache.isEmpty()) {
                const msg = await this._createGetBlocksMsg();
                debugMsg(`(address: "${this._debugAddress}") sending "${msg.message}" to "${peer.address}"`);
                await peer.pushMessage(msg);
            }
        }

        async _requestUnknownBlocks() {

            // request all unknown blocks
            const {mapPeerBlocks, mapPeerAhead} = this._createMapBlockPeer();
            for (let peer of mapPeerAhead.values()) {
                this._queryPeerForRestOfBlocks(peer);
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
                    debugMsg(`Requesting ${msg.inventory.vector.length} blocks from ${peer.address}`);
                    await peer.pushMessage(msg);
                }
            }
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

            // allow use pending blocks data
            completed = completed !== undefined;

            let contract = await this._storage.getContract(contractAddress);
            if (!contract) throw new Error(`Contract ${contractAddress} not found`);

            if (!completed) {
                const pendingContract = this._pendingBlocks.getContract(contractAddress, contract.getConciliumId());
                if (pendingContract) contract = pendingContract;
            }

            const newEnv = {
                contractAddr: contract.getStoredAddress(),
                balance: contract.getBalance()
            };

            return await this._app.runContract(
                Number.MAX_SAFE_INTEGER,
                {method, arrArguments},
                contract,
                newEnv,
                undefined,
                this._createCallbacksForApp(new PatchDB(), new PatchDB(), Crypto.randomBytes(32)),
                true
            );
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
            const calculatedHash = this._calcHeight(block.parentHashes);
            assert(calculatedHash === block.getHeight(),
                `Block ${block.getHash()} has incorrect height ${calculatedHash} (expected ${block.getHash()}`
            );
        }
    };
};

