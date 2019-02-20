const assert = require('assert');
const typeforce = require('typeforce');

const debugLib = require('debug');
const {sleep} = require('../utils');
const types = require('../types');
const Tick = require('tick-tock');

const debugNode = debugLib('node:app');
const debugMsg = debugLib('node:messages');

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
        RequestCache
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

            const {arrSeedAddresses, arrDnsSeeds, nMaxPeers, queryTimeout} = options;

            this._mutex = new Mutex();

            this._storage = new Storage({...options, mutex: this._mutex});

            // nonce for MsgVersion to detect connection to self (use crypto.randomBytes + readIn32LE) ?
            this._nonce = parseInt(Math.random() * 100000);

            this._arrSeedAddresses = arrSeedAddresses || [];
            this._arrDnsSeeds = arrDnsSeeds || Constants.DNS_SEED;

            this._queryTimeout = queryTimeout || Constants.PEER_QUERY_TIMEOUT;

            // create mempool
            this._mempool = new Mempool(options);

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

            this._app = new Application(options);

            this._rebuildPromise = this._rebuildBlockDb();

            this._setUnknownBlocks = new Set();
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
            return await peer.connect();

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
//                    logger.error(e.message);
                    logger.error(e);
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
            this._requestCache.done(strTxHash);

            try {
                await this._processReceivedTx(tx);

                // TODO: choose random 2 to inform (to prevent overspam)
                // inform other about good TX
                const inv = new Inventory();
                inv.addTx(tx);
                const msgInv = new MsgInv();
                msgInv.inventory = inv;
                await this._peerManager.broadcastToConnected(undefined, msgInv);
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

            const lock = await this._mutex.acquire([`${block.getHash()}`]);
            try {

                // since we building DAG, it's faster
                if (this._mainDag.getBlockInfo(block.hash())) {
                    logger.error(`Block ${block.hash()} already known!`);
                    return;
                }

                // remove it (if was there)
                this._setUnknownBlocks.delete(block.getHash());

                const result = await this._processBlock(block);
                if (typeof result === 'number') {
                    await this._requestUnknownBlocks(peer);
                } else if (result instanceof PatchDB) {

                    // TODO: choose random 2 to inform (to prevent overspam)
                    // inform other about good block
                    const inv = new Inventory();
                    inv.addBlock(block);
                    const msgInv = new MsgInv();
                    msgInv.inventory = inv;
                    await this._peerManager.broadcastToConnected(undefined, msgInv);
                }
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
         * General flow:
         * 1. Do we have all parents?
         * - and all of them successfully executed -> exec block
         * - have bad parent -> this block is bad (marked in _canExecuteBlock)
         * 2. we don't have all parents -> mark as InFlight, request that block
         *
         * @param {Block} block
         * @return {Promise <PatchDB | Number | null >} Number means _requestUnknownBlocks
         * @private
         */
        async _processBlock(block) {
            let retVal = null;
            debugNode(`Processing block ${block.hash()}`);

            // check: whether we already processed this block?
            const blockInfoDag = this._mainDag.getBlockInfo(block.getHash());

            if (blockInfoDag && (blockInfoDag.isFinal() || this._pendingBlocks.hasBlock(block.getHash()))) {
                logger.error(`Trying to process ${block.getHash()} more than one time!`);
                return retVal;
            }

            // NO RETURN BEYOND THIS POINT before lock release ! or we'll have a dead lock
            const lock = await this._mutex.acquire(['block']);
            try {

                await this._verifyBlock(block);

                // it will check readiness of parents
                if (this.isGenesisBlock(block) || await this._canExecuteBlock(block)) {

                    // we'r ready to execute this block right now
                    const patchState = await this._execBlock(block);
                    await this._acceptBlock(block, patchState);
                    await this._postAcceptBlock(block);

                    retVal = patchState;
                } else {

                    // not ready, so we should request unknown blocks
                    retVal = 1;
                }
            } catch (e) {
                throw e;
            } finally {
                this._mutex.release(lock);
            }

            return retVal;
        }

        async _requestUnknownBlocks(peer) {
            if (!this._setUnknownBlocks.size) return;

            const msgGetData = new MsgGetData();
            const invToRequest = new Inventory();

            for (let hash of this._setUnknownBlocks) {
                if (!this._requestCache.isRequested(hash)) {
                    this._requestCache.request(hash);
                    invToRequest.addBlockHash(hash);
                }
            }

            if (invToRequest.vector.length) {
                debugNode(`Requested unknown blocks: ${invToRequest.vector.map(v => `"${v.hash.toString('hex')}"`)}`);

                msgGetData.inventory = invToRequest;
                peer.pushMessage(msgGetData);
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
            for (let objVector of invMsg.inventory.vector) {

                // we already requested it (from another node), so let's skip it
                if (this._requestCache.isRequested(objVector.hash)) continue;

                let bShouldRequest = false;
                if (objVector.type === Constants.INV_TX) {

                    // TODO: more checks? for example search this hash in UTXOs?
                    bShouldRequest = !this._mempool.hasTx(objVector.hash);
                } else if (objVector.type === Constants.INV_BLOCK) {

                    bShouldRequest = !await this._storage.hasBlock(objVector.hash);
                }

                if (bShouldRequest) {
                    invToRequest.addVector(objVector);
                    this._requestCache.request(objVector.hash);
                }
            }

            if (invToRequest.vector.length) {
                const msgGetData = new MsgGetData();
                msgGetData.inventory = invToRequest;
                debugMsg(
                    `(address: "${this._debugAddress}") requesting ${invToRequest.vector.length} hashes from "${peer.address}"`);
                await peer.pushMessage(msgGetData);
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

            const msgInv = new MsgInv();
            msgInv.inventory = inventory;

            debugMsg(`(address: "${this._debugAddress}") sending "${msgInv.message}" to "${peer.address}"`);
            await peer.pushMessage(msgInv);
        }

        /**
         *
         * @param {Array} arrHashes - last known hashes
         * @returns {Set<any>} set of hashes descendants of arrHashes
         * @private
         */
        _getBlocksFromLastKnown(arrHashes) {
            const setBlocksToSend = new Set();

            // TODO: implement better algo
            if (!arrHashes.length || !arrHashes.every(hash => !!this._mainDag.getBlockInfo(hash))) {

                // we missed at least one of those hashes! so we think peer is at wrong DAG
                // sent our version of DAG starting from Genesis
                arrHashes = [Constants.GENESIS_BLOCK];

                // Genesis wouldn't be included (same as all of arrHashes), so add it here
                setBlocksToSend.add(Constants.GENESIS_BLOCK);
            }

            let currentLevel = [];
            arrHashes.forEach(hash => this._mainDag.getChildren(hash).forEach(child => currentLevel.push(child)));
            do {
                const setNextLevel = new Set();
                for (let hash of currentLevel) {

                    this._mainDag.getChildren(hash).forEach(
                        child => {

                            // we already processed it
                            if (!setBlocksToSend.has(child)) setNextLevel.add(child);
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

            // next stage
            const msg = await this._createRequestBlocksMsg();
            debugMsg(`(address: "${this._debugAddress}") sending "${msg.message}" to "${peer.address}"`);
            await peer.pushMessage(msg);

            // TODO: move loadDone after we got all we need from peer
            peer.loadDone = true;
        }

        async _createRequestBlocksMsg() {
            const msg = new MsgGetBlocks();
            msg.arrHashes = await this._storage.getLastAppliedBlockHashes();
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
                        break;
                    case 'txReceipt':
                        return await this._storage.getTxReceipt(content);
                    case 'getBlock':
                        const cBlock = await this._storage.getBlock(content);
                        return cBlock.toObject();
                    case 'getTips':
                        let arrHashes = this._pendingBlocks.getTips();
                        if (!arrHashes || !arrHashes.length) {
                            arrHashes =
                                await this._storage.getLastAppliedBlockHashes();
                        }
                        return arrHashes.map(hash => this._mainDag.getBlockInfo(hash));
                    default:
                        throw new Error(`Unsupported method ${event}`);
                }
            } catch (e) {
                logger.error('RPC error.', e);
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

            await this._processTx(false, tx);

            this._mempool.addTx(tx);
            this._informNeighbors(tx);
        }

        /**
         *
         * @param {Boolean} isGenesis
         * @param {Transaction} tx
         * @param {PatchDB} patchForBlock - OPTIONAL!
         * @return {Promise<{fee, patchThisTx}>} fee and patch for this TX
         * @private
         */
        async _processTx(isGenesis, tx, patchForBlock) {
            let patchThisTx = new PatchDB();
            let totalHas = 0;
            let fee = 0;

            // process input (for regular block only)
            if (!isGenesis) {
                tx.verify();
                const mapUtxos = await this._storage.getUtxosCreateMap(tx.utxos);
                ({totalHas, patch: patchThisTx} = this._app.processTxInputs(tx, mapUtxos, patchForBlock));
            }

            let totalSent = 0;
            let contract;

            if (tx.isContractCreation() || (contract = await this._getContractFromTx(tx, patchForBlock))) {

                // process contract creation/invocation
                fee = await this._processContract(isGenesis, contract, tx, patchThisTx, totalHas);
            } else {

                // regular payment
                totalSent = this._app.processPayments(tx, patchThisTx);
                if (!isGenesis) {
                    fee = totalHas - totalSent;
                    if (fee < Constants.MIN_TX_FEE) {
                        throw new Error(`Tx ${tx.hash()} fee ${fee} too small!`);
                    }
                }
            }

            // TODO: MIN_TX_FEE is fee per 1Kb of TX size
            // TODO: rework fee

            return {fee, patchThisTx};
        }

        /**
         *
         * @param {Boolean} isGenesis
         * @param {Contract | undefined} contract
         * @param {Transaction} tx
         * @param {PatchDB} patchThisTx
         * @param {Number} nCoinsIn - sum of all inputs coins
         * @returns {Promise<number>}
         * @private
         */
        async _processContract(isGenesis, contract, tx, patchThisTx, nCoinsIn) {
            let fee = 0;

            // contract creation/invocation has 2 types of change:
            // 1st - usual for UTXO just send exceeded coins to self
            // 2nd - not used coins (in/out diff - coinsUsed) as internal TX
            let receipt;

            // global variables for contract
            const environment = {
                contractTx: tx.hash()
            };

            // get max contract fee
            let maxFee;
            let coinsLimit;
            if (!isGenesis) {
                const totalSent = this._app.processPayments(tx, patchThisTx, 1);
                maxFee = nCoinsIn - totalSent;
                coinsLimit = tx.getContractCoinsLimit();
                coinsLimit = maxFee < coinsLimit ? maxFee : coinsLimit;

                if (coinsLimit < Constants.MIN_CONTRACT_FEE) {
                    throw new Error(`Tx ${tx.hash()} CONTRACT fee ${maxFee} less than ${Constants.MIN_CONTRACT_FEE}!`);
                }

            } else {
                maxFee = Number.MAX_SAFE_INTEGER;
                coinsLimit = Number.MAX_SAFE_INTEGER;
            }

            if (!contract) {

                // contract creation
                environment.contractAddr = Crypto.getAddress(tx.hash());
                ({receipt, contract} =
                    await this._app.createContract(coinsLimit, tx.getContractCode(), environment));
            } else {

                // contract invocation
                assert(
                    contract.getGroupId() === tx.witnessGroupId,
                    `TX groupId: "${tx.witnessGroupId}" != contract groupId`
                );

                environment.contractAddr = contract.getStoredAddress();
                receipt = await this._app.runContract(coinsLimit, tx.getContractCode(), contract, environment);
            }

            // send change (not for Genesis)
            if (!isGenesis) {
                fee = this._createContractChange(tx, maxFee, patchThisTx, contract, receipt);
            }
            patchThisTx.setReceipt(tx.hash(), receipt);
            patchThisTx.setContract(contract);

            return fee;
        }

        async _getContractFromTx(tx, patchForBlock) {
            const arrOutCoins = tx.getOutCoins();
            const buffContractAddr = arrOutCoins[0].getReceiverAddr();
            let contract;

            if (!patchForBlock || !(contract = patchForBlock.getContract(buffContractAddr))) {

                // try to load contract data from storage
                contract = await this._storage.getContract(buffContractAddr);
            }

            return contract;
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
            this._peerManager.broadcastToConnected(undefined, msgInv);
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

            let patchState = this._pendingBlocks.mergePatches(block.parentHashes);
            patchState.setGroupId(block.witnessGroupId);
            const isGenesis = this.isGenesisBlock(block);

            debugNode(`Block ${block.getHash()} being executed`);

            let blockFees = 0;
            const blockTxns = block.txns;

            // should start from 1, because coinbase tx need different processing
            for (let i = 1; i < blockTxns.length; i++) {
                const tx = new Transaction(blockTxns[i]);
                const {fee, patchThisTx} = await this._processTx(isGenesis, tx, patchState);
                blockFees += fee;
                patchState = patchState.merge(patchThisTx);
            }

            // process coinbase tx
            if (!isGenesis) {
                this._processBlockCoinbaseTX(block, blockFees, patchState);
            }

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
            this._checkCoinbaseTx(coinbase, blockFees);
            const coins = coinbase.getOutCoins();
            for (let i = 0; i < coins.length; i++) {
                patchState.createCoins(coinbase.hash(), i, coins[i]);
            }
        }

        async _acceptBlock(block, patchState) {

            debugNode(`Block ${block.getHash()} accepted`);

            // write block to storage & DAG
            await this._storeBlockAndInfo(block, new BlockInfo(block.header));

            // save block to graph of pending blocks
            this._pendingBlocks.addBlock(block, patchState);

            // TODO: filter for coinbase TX (we don't find it in mempool)
            this._mempool.removeForBlock(block.getTxHashes());

            // check for finality
            await this._processFinalityResults(
                await this._pendingBlocks.checkFinality(block.getHash(), await this._storage.getWitnessGroupsCount())
            );

            // store pending blocks (for restore state after node restart)
            await this._storage.updatePendingBlocks(this._pendingBlocks.getAllHashes());

            this._informNeighbors(block);

            // process depending blocks (they are unprocessed)
            const arrChildHashes = this._mainDag.getChildren(block.getHash());
            for (let hash of arrChildHashes) {
                if (await this._storage.hasBlock(hash)) await this._processBlock(await this._storage.getBlock(hash));
            }
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
        }

        async _updateLastAppliedBlocks(arrTopStable) {
            const arrPrevTopStableBlocks = await this._storage.getLastAppliedBlockHashes();
            const mapPrevGroupIdHash = new Map();
            arrPrevTopStableBlocks.forEach(hash => {
                const cBlockInfo = this._mainDag.getBlockInfo(hash);
                mapPrevGroupIdHash.set(cBlockInfo.getWitnessId(), hash);
            });

            const mapNewGroupIdHash = new Map();
            arrTopStable.forEach(hash => {
                const cBlockInfo = this._mainDag.getBlockInfo(hash);
                mapNewGroupIdHash.set(cBlockInfo.getWitnessId(), hash);
            });

            const arrNewLastApplied = [];
            const nGroupCount = await this._storage.getWitnessGroupsCount();
            for (let i = 0; i < nGroupCount; i++) {
                const hash = mapNewGroupIdHash.get(i) || mapPrevGroupIdHash.get(i);

                // group could be created, but still no final blocks
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
                `Block ${block.hash()}. GroupId: ${block.witnessGroupId}. With ${block.txns.length} TXns and parents ${block.parentHashes} was accepted`
            );
            if (this._rpc) {
                this._rpc.informWsSubscribers('newBlock', block.header);
            }
        }

        /**
         * You can add block reward checks here
         *
         * @param {Transaction} tx
         * @param {Number} blockFees - calculated (for each TX) value
         * @private
         */
        _checkCoinbaseTx(tx, blockFees) {
            assert(tx.isCoinbase(), 'Not a coinbase TX!');
            assert(tx.amountOut() === blockFees, 'Bad amount in coinbase!');
        }

        isGenesisBlock(block) {
            return block.hash() === Constants.GENESIS_BLOCK;
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

            // we create Genesis manually, so we sure that it's valid
            if (block.getHash() === Constants.GENESIS_BLOCK) return;

            // block should have at least one parent!
            assert(Array.isArray(block.parentHashes) && block.parentHashes.length);

            // signatures
            if (checkSignatures && !this.isGenesisBlock(block)) await this._verifyBlockSignatures(block);

            // merkleRoot
            assert(block.hash() !== block.merkleRoot.toString('hex'), `Bad merkle root for ${block.hash()}`);

            // TX collision
            await this._storage.checkTxCollision(block.getTxHashes());
        }

        /**
         * Ok, if all block signatures (number og it equals to group quorum) matches delegates pubKeys
         *
         * @param {Blob} block
         * @returns {Promise<void>}
         * @private
         */
        async _verifyBlockSignatures(block) {
            const buffBlockHash = Buffer.from(block.hash(), 'hex');

            const witnessGroupDefinition = await this._storage.getWitnessGroupById(block.witnessGroupId);
            assert(witnessGroupDefinition, `Unknown witnessGroupId: ${block.witnessGroupId}`);
            const arrPubKeys = witnessGroupDefinition.getDelegatesPublicKeys();
            assert(
                block.signatures.length === witnessGroupDefinition.getQuorum(),
                `Expected ${witnessGroupDefinition.getQuorum()} signatures, got ${block.signatures.length}`
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
         * @param {Array} arrPedingBlocksHashes - hashes of all pending blocks
         */
        async _buildMainDag(arrPedingBlocksHashes) {
            this._mainDag = new MainDag();

            let arrCurrentLevel = arrPedingBlocksHashes;
            while (arrCurrentLevel.length) {
                const setNextLevel = new Set();
                for (let hash of arrCurrentLevel) {
                    debugNode(`Processing ${hash}`);

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

                // we are already executed this block
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

        async _blockBad(block) {
            const blockInfo = new BlockInfo(block.header);
            blockInfo.markAsBad();
            if (!await this._mainDag.getBlockInfo(block.getHash()) ||
                !await this._storage.hasBlock(block.getHash())) {
                await this._storeBlockAndInfo(block, blockInfo);
            }
        }

        async _blockInFlight(block) {
            const blockInfo = new BlockInfo(block.header);
            blockInfo.markAsInFlight();
            if (!await this._mainDag.getBlockInfo(block.getHash()) ||
                !await this._storage.hasBlock(block.getHash())) {
                await this._storeBlockAndInfo(block, blockInfo);
            }
        }

        /**
         * Depending of BlockInfo flag - store block & it's info in _mainDag & _storage
         *
         * @param {Block} block
         * @param {BlockInfo} blockInfo
         * @private
         */
        async _storeBlockAndInfo(block, blockInfo) {
            typeforce(typeforce.tuple(types.Block, types.BlockInfo), arguments);

            if (blockInfo.isBad()) {

                // we don't store entire of bad blocks, but store its headers (to prevent processing it again)
                await this._storage.saveBlockInfo(blockInfo);
            } else {

                // save block, and it's info
                await this._storage.saveBlock(block, blockInfo);
            }
            this._mainDag.addBlock(blockInfo);
        }

        /**
         *
         * @param {Block} block
         * @return {Promise<boolean || Set>}
         * @private
         */
        async _canExecuteBlock(block) {
            let result = true;
            for (let hash of block.parentHashes) {
                let blockInfo = this._mainDag.getBlockInfo(hash);

                // parent is good!
                if ((blockInfo && blockInfo.isFinal()) || this._pendingBlocks.hasBlock(hash)) continue;

                // parent is bad
                if (blockInfo && blockInfo.isBad()) {

                    // it will be marked as bad in _handleBlockMessage
                    throw new Error(
                        `Block ${block.getHash()} refer to bad parent ${hash}`);
                }

                // parent is not processed yet. block couldn't be executed
                if (!blockInfo && !this._setUnknownBlocks.has(hash) && !await this._storage.hasBlock(hash)) {

                    // we didn't heard about this block. let's add it for downloading
                    this._queueBlockRequest(hash);
                }
                result = false;
            }

            // mark block for future processing
            if (!result) await this._blockInFlight(block);
            return result;
        }

        _queueBlockRequest(hash) {
            typeforce(types.Hash256bit, hash);
            const strHash = Buffer.isBuffer(hash) ? hash.toString('hex') : hash;

            this._setUnknownBlocks.add(strHash);
        }

        /**
         * Block failed to become FINAL, let's unwind it
         *
         * @param {Block} block
         * @private
         */
        async _unwindBlock(block) {
            debugNode(`(address: "${this._debugAddress}") Unwinding txns from block: "${block.getHash()}"`);
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
            this._peerManager.saveAllPeers();
            console.log('Shutting down');
            process.exit(1);
        }

        /**
         *
         * @param {Buffer} buffReceiver
         * @param {Number} amount
         * @param {PatchDB} patch
         * @returns {String} - new internal TX hash
         * @private
         */
        _createInternalTx(buffReceiver, amount, patch) {
            typeforce(typeforce.tuple(types.Address, typeforce.Number), [buffReceiver, amount]);

            const coins = new Coins(amount, buffReceiver);
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
            if (!addrChangeReceiver) return maxFee;

            let fee = maxFee;

            if (Buffer.isBuffer(addrChangeReceiver)) {
                fee = receipt.getCoinsUsed();
                const changeTxHash = this._createInternalTx(
                    tx.getContractChangeReceiver(),
                    maxFee - fee,
                    patch
                );
                receipt.addInternalTx(changeTxHash);
                patch.setReceipt(tx.hash(), receipt);
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
            await this._buildMainDag(arrPendingBlocksHashes);

            const arrLastStableHashes = await this._storage.getLastAppliedBlockHashes();
            await this._rebuildPending(arrLastStableHashes, arrPendingBlocksHashes);
        }
    };
};

