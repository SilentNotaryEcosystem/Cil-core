const assert = require('assert');
const typeforce = require('typeforce');

const debugLib = require('debug');
const {sleep} = require('../utils');
const types = require('../types');
const Tick = require('tick-tock');

const debugNode = debugLib('node:app');
const debugMsg = debugLib('node:messages');

module.exports = (factory) => {
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
        Mutex
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
            const {arrSeedAddresses, arrDnsSeeds, nMaxPeers, queryTimeout} = options;

            this._storage = new Storage(options);

            // nonce for MsgVersion to detect connection to self (use crypto.randomBytes + readIn32LE) ?
            this._nonce = parseInt(Math.random() * 100000);

            this._arrSeedAddresses = arrSeedAddresses || [];
            this._arrDnsSeeds = arrDnsSeeds;

            this._queryTimeout = queryTimeout || Constants.PEER_QUERY_TIMEOUT;
            this._transport = new Transport(options);

            this._myPeerInfo = new PeerInfo({
                capabilities: [
                    {service: Constants.NODE}
                ],
                address: Transport.strToAddress(this._transport.myAddress),
                port: this._transport.port
            });

            // used only for debugging purpose. Feel free to remove
            this._debugAddress = this._transport.myAddress;

            this._peerManager = new PeerManager({transport: this._transport});

            // TODO: add handler for new peer, to bradcast it to neighbour (connected peers)!
            this._peerManager.on('message', this._incomingMessage.bind(this));
            debugNode(`(address: "${this._debugAddress}") start listening`);
            this._peerManager.on('disconnect', this._peerDisconnect.bind(this));

            this._transport.on('connect', this._incomingConnection.bind(this));

            // create mempool
            this._mempool = new Mempool(options);

            //start RPC
            if (options.rpcUser && options.rpcPass) {
                this._rpc = new RPC(options);
                this._rpc.on('rpc', this._rpcHandler.bind(this));
            }

            this._app = new Application(options);

            this._rebuildPromise = this._storage.getPendingBlockHashes().then(arrOfHashes => {
                this._pendingBlocks = new PendingBlocksManager(arrOfHashes);
            });

            this._mainDag = new MainDag();
            this._setUnknownBlocks = new Set();
            this._msecOffset = 0;

            this._reconnectTimer = new Tick(this);
            this._listenPromise = this._transport.listen().catch(err => console.error(err));
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

            // add seed peers to peerManager
            for (let strAddr of this._arrSeedAddresses) {
                const peer = new PeerInfo({
                    address: Transport.strToAddress(strAddr),
                    capabilities: [{service: Constants.NODE}]
                });
                this._peerManager.addPeer(peer);
            }

            // start connecting to peers
            // TODO: make it not greedy, because we should keep slots for incoming connections! i.e. twice less than _nMaxPeers
            const arrBestPeers = this._findBestPeers();
            await this._connectToPeers(arrBestPeers);
            this._reconnectTimer.setInterval(Constants.PEER_RECONNECT_TIMER, this._reconnectPeers.bind(this),  Constants.PEER_RECONNECT_INTERVAL);
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
         *
         * @return {Array} of Peers we decided to be best peers to connect
         * @private
         */
        _findBestPeers() {

            // we prefer witness nodes
            // TODO: REWORK! it's not good idea to overload witnesses!
            const arrWitnessNodes = this._peerManager.filterPeers({service: Constants.WITNESS});
            if (arrWitnessNodes.length) return arrWitnessNodes;

            // but if there is no such - use any nodes
            return this._peerManager.filterPeers({service: Constants.NODE});
        }

        /**
         * Add DNS peers into this._arrSeedAddresses
         *
         * @return {Promise<void>}
         * @private
         */
        async _mergeSeedPeers() {
            if (this._arrDnsSeeds) {
                const arrDnsPeers = await this._queryDnsRecords(this._arrDnsSeeds);
                this._arrSeedAddresses = this._arrSeedAddresses.concat(arrDnsPeers);
            }
        }

        /**
         * Query DNS records for peerAddresses
         *
         * @param {Array} dnsSeeds
         * @param {String} dnsSeeds[0] - like 'dnsseed.bluematt.me'
         * @return {Promise<Array>} - array of addresses of seed nodes
         * @private
         */
        async _queryDnsRecords(dnsSeeds) {
            let arrResult = [];
            const arrPromises = [];
            for (let name of dnsSeeds) {
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
                debugNode(`(address: "${this._debugAddress}") incoming connection from "${connection.remoteAddress}"`);
                const newPeer = new Peer({connection, transport: this._transport});

                const result = this._peerManager.addPeer(newPeer);
                if (result instanceof Peer) return;

                // peer already connected or banned
                let reason;
                if (result === Constants.REJECT_BANNED) {
                    reason = 'You are banned';
                } else if (result === Constants.REJECT_DUPLICATE) {
                    reason = 'Duplicate connection';
                } else if (result === Constants.REJECT_BANNEDADDRESS) reason = 'Address temporary banned';

                const message = new MsgReject({
                    code: result,
                    reason
                });
                debugMsg(
                    `(address: "${this._debugAddress}") sending message "${message.message}" to "${newPeer.address}"`);
                await newPeer.pushMessage(message);
                newPeer.disconnect();
            } catch (err) {
                logger.error(err);
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
                    logger.error(e);
                }
            }
        }

        async _reconnectPeers() {
            let bestPeers = this._findBestPeers().filter(p => p.disconnected);
            let peers = bestPeers.splice(0, Constants.MIN_PEERS - this._peerManager.connectedPeers().length);
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
                if (message.isReject()) {
                    const rejectMsg = new MsgReject(message);

                    // connection will be closed by other end
                    logger.log(`Peer: "${peer.address}" rejection reason: "${rejectMsg.reason}"`);

                    // if it's just collision - 1 point not too much, but if peer is malicious - it will raise to ban
                    peer.misbehave(1);
                    peer.loadDone = true;
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
                if (message.isPong()) {
                    return;
                }

                throw new Error(`Unhandled message type "${message.message}"`);
            } catch (err) {
                logger.error(err, `Peer ${peer.address}`);

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

            //TODO: make sure that's a tx we requested! not pushed to us

            // this will check syntactic correctness
            const msgTx = new MsgTx(message);
            const tx = msgTx.tx;

            try {
                await this._processReceivedTx(tx);
            } catch (e) {
                logger.error(e);
                peer.ban();
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

            //TODO: make sure that's a block we requested! not pushed to us

            const msg = new MsgBlock(message);
            let block;
            try {
                block = msg.block;

                // since we building DAG, it's faster
                if (await this._mainDag.getBlockInfo(block.hash())) {
                    //                if (await this._storage.hasBlock(block.hash())) {
                    logger.error(`Block ${block.hash()} already known!`);
                    return;
                }

                // remove it (if was there)
                this._setUnknownBlocks.delete(block.getHash());

                await this._processBlock(block);

            } catch (e) {
                await this._blockBad(block);
                logger.error(e);
                peer.ban();
                throw e;
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
         * @return {Promise <PatchDB | undefined>}
         * @private
         */
        async _processBlock(block) {

            const lock = await Mutex.acquire(['block']);

            try {
                debugLib(`Processing block ${block.hash()}`);

                // check: whether we already processed this block?
                const blockInfoDag = this._mainDag.getBlockInfo(block.getHash());

                if (blockInfoDag && (blockInfoDag.isFinal() || this._pendingBlocks.hasBlock(block.getHash()))) {
                    logger.error(`Trying to process ${block.getHash()} more than one time!`);
                    return;
                }

                // TODO: add mutex here?
                await this._verifyBlock(block);

                // it will check readiness of parents
                if (this.isGenesisBlock(block) || await this._canExecuteBlock(block)) {

                    // we'r ready to execute this block right now
                    const patchState = await this._execBlock(block);
                    await this._acceptBlock(block, patchState);
                    await this._postAccepBlock(block);

                    return patchState;
                } else {

                    // not ready, so we should request unknown blocks
                    this._requestUnknownBlocks();
                }
            } catch (e) {
                throw e;
            } finally {
                Mutex.release(lock);
            }
        }

        _requestUnknownBlocks() {
            const msgGetData = new MsgGetData();
            const invToRequest = new Inventory();

            for (let hash of this._setUnknownBlocks) {
                invToRequest.addBlockHash(hash);
            }

            msgGetData.inventory = invToRequest;

            // TODO: this will result a duplicate responses. Rewrite it.
            this._peerManager.broadcastToConnected(undefined, msgGetData);
        }

        /**
         * Handler for MSG_INV message.
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
                let bShouldRequest = false;
                if (objVector.type === Constants.INV_TX) {

                    // TODO: more checks? for example search this hash in UTXOs?
                    bShouldRequest = !this._mempool.hasTx(objVector.hash);
                } else if (objVector.type === Constants.INV_BLOCK) {

                    bShouldRequest = !await this._storage.hasBlock(objVector.hash);
                }

                if (bShouldRequest) invToRequest.addVector(objVector);
            }

            // TODO: add cache of already requested items to PeerManager, but this cache should expire, because node could fail
            if (invToRequest.vector.length) {
                const msgGetData = new MsgGetData();
                msgGetData.inventory = invToRequest;
                debugMsg(`(address: "${this._debugAddress}") sending "${msgGetData.message}" to "${peer.address}"`);
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

            // TODO: implement better algo
            const msg = new MsgGetBlocks(message);
            let arrHashes = msg.arrHashes;
            const inventory = new Inventory();

            if (!arrHashes.length || !arrHashes.every(hash => !!this._mainDag.getBlockInfo(hash))) {

                // we missed at least one of those hashes! so we think peer is at wrong DAG
                // sent our version of DAG starting from Genesis
                arrHashes = [Constants.GENESIS_BLOCK];

                // Genesis wouldn't be included, so add it here
                inventory.addBlockHash(Constants.GENESIS_BLOCK);
            }

            let currentLevel = [];
            arrHashes.map(hash => this._mainDag.getChildren(hash).forEach(child => currentLevel.push(child)));
            do {
                const nextLevel = [];
                for (let hash of currentLevel) {
                    inventory.addBlockHash(hash);
                    this._mainDag.getChildren(hash).forEach(child => nextLevel.push(child));
                    if (inventory.vector.length > Constants.MAX_BLOCKS_INV) break;
                }
                currentLevel = nextLevel;

            } while (currentLevel.length && inventory.vector.length < Constants.MAX_BLOCKS_INV);

            const msgInv = new MsgInv();
            msgInv.inventory = inventory;

            debugMsg(`(address: "${this._debugAddress}") sending "${msgInv.message}" to "${peer.address}"`);
            await peer.pushMessage(msgInv);
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
                    debugMsg(`(address: "${this._debugAddress}") sending "${msg.message}" to "${peer.address}"`);
                    await peer.pushMessage(msg);
                } catch (e) {
                    logger.error(e);
                    peer.misbehave(5);

                    // break loop
                    if (peer.banned) return;
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

                peer.disconnect();
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
                    peer.misbehave(1);
                    return;
                }

                // very beginning of inbound connection
                if (peer.inbound) {
                    peer.peerInfo = message.peerInfo;
                    this._peerManager.updateHandlers(peer);

                    // send own version
                    debugMsg(`(address: "${this._debugAddress}") sending own "${MSG_VERSION}" to "${peer.address}"`);
                    await peer.pushMessage(this._createMsgVersion());
                }

                this._adjustNetworkTime(_offset);
                peer.offsetDelta = _offset / 2;

                const msgVerack = new MsgCommon();
                msgVerack.verAckMessage = true;
                debugMsg(`(address: "${this._debugAddress}") sending "${MSG_VERACK}" to "${peer.address}"`);
                await peer.pushMessage(msgVerack);

            } else {
                debugNode(`Has incompatible protocol version ${message.protocolVersion}`);
                peer.disconnect();
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

                // if we initiated connection to peer, so let's ask for known peers
                if (!peer.inbound) {
                    const msgGetAddr = new MsgCommon();
                    msgGetAddr.getAddrMessage = true;
                    debugMsg(`(address: "${this._debugAddress}") sending "${MSG_GET_ADDR}"`);
                    await peer.pushMessage(msgGetAddr);
                }
            }
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
            const arrPeerInfos = this._peerManager.filterPeers().map(peer => peer.peerInfo.data);

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
                const newPeer = this._peerManager.addPeer(peerInfo);
                if (newPeer instanceof Peer) {
                    debugNode(`(address: "${this._debugAddress}") added peer "${newPeer.address}" to peerManager`);
                }
            }

            // if we initiated connection - let's request for new blocks
            if (!peer.inbound) {
                const msg = new MsgGetBlocks();
                msg.arrHashes = await this._storage.getLastAppliedBlockHashes();
                debugMsg(`(address: "${this._debugAddress}") sending "${msg.message}"`);
                await peer.pushMessage(msg);
            }

            // TODO: move loadDone after we got all we need from peer
            peer.loadDone = true;
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
        async _rpcHandler({event, content}) {
            switch (event) {
                case 'tx':
                    await this._processReceivedTx(content).catch(err => logger.error('RPC error:', err));
                    break;
            }
        }

        async _processReceivedTx(tx) {

            // TODO: check against DB & valid claim here rather slow, consider light checks, now it's heavy strict check
            // this will check for double spend in pending txns
            // if something wrong - it will throw error
            await this._processTx(false, tx);

            this._mempool.addTx(tx);
            this._informNeighbors(tx);
        }

        /**
         *
         * @param {Boolean} isGenesis
         * @param {Transaction} tx
         * @param {PatchDB} patchForBlock - OPTIONAL!
         * @return {Promise<number>} fee for this TX
         * @private
         */
        async _processTx(isGenesis, tx, patchForBlock) {
            const patch = patchForBlock ? patchForBlock : new PatchDB();
            let totalHas = 0;

            // process input (for regular block only)
            if (!isGenesis) {
                tx.verify();
                const mapUtxos = await this._storage.getUtxosCreateMap(tx.utxos);
                ({totalHas} = this._app.processTxInputs(tx, mapUtxos, patchForBlock));
            }

            // TODO: check for TX type: payment or smart contract deploy/call and process separately
            // TODO: for regular payment make "DB-transaction-like" behavior (revert spending coins in processTxInputs)
            let totalSent = 0;
            if (tx.hasOneReceiver()) {

                // prepare global variables for contract
                const environment = {
                    contractTx: tx.hash()
                };

                if (tx.isContractCreation()) {

                    // Newly deployed contract address!
                    environment.contractAddr = Crypto.getAddress(tx.hash());

                    const receipt = await this._app.createContract(tx.getCode(), patch, environment);
                    patch.setReceipt(tx.hash(), receipt);

                    // TODO implement fee
                } else {
                    const [coins] = tx.getOutCoins();

                    // check: whether it's contract invocation
                    let contract;
                    if (patchForBlock && patchForBlock.getContract(coins.getReceiverAddr())) {

                        // contract was changed in previous blocks
                        contract = patchForBlock.getContract(coins.getReceiverAddr());
                    } else {

                        // try to load contract data from storage
                        contract = await this._storage.getContract(coins.getReceiverAddr());
                    }

                    if (contract) {
                        assert(
                            contract.getGroupId() === tx.witnessGroupId,
                            `TX groupId: "${tx.witnessGroupId}" != contract groupId`
                        );

                        environment.contractAddr = coins.getReceiverAddr().toString('hex');
                        const receipt = await this._app.runContract(tx.getCode(), patch, contract, environment);
                        patch.setReceipt(tx.hash(), receipt);

                        // TODO implement fee
                    } else {

                        // regular payment
                        totalSent = this._app.processPayments(tx, patch);
                    }
                }
            } else {

                // regular payment
                totalSent = this._app.processPayments(tx, patch);
            }
            const fee = totalHas - totalSent;

            // TODO: MIN_TX_FEE is fee per 1Kb of TX size
            // TODO: rework fee
            if (!isGenesis && fee < Constants.MIN_TX_FEE) throw new Error(`Tx ${tx.hash()} fee ${fee} too small!`);

            return fee;
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
            debugNode(`Informing neighbors about new item ${item.hash()}`);
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

            const patchState = this._pendingBlocks.mergePatches(block.parentHashes);
            patchState.setGroupId(block.witnessGroupId);
            const isGenesis = this.isGenesisBlock(block);

            let blockFees = 0;
            const blockTxns = block.txns;

            // should start from 1, because coinbase tx need different processing
            for (let i = 1; i < blockTxns.length; i++) {
                const tx = new Transaction(blockTxns[i]);
                const fee = await this._processTx(isGenesis, tx, patchState);
                blockFees += fee;
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
                await this._processBlock(await this._storage.getBlock(hash));
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

            await this._storage.applyPatch(patchToApply);
            await this._storage.updateLastAppliedBlocks(arrTopStable);

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

        /**
         * post hook
         *
         * @param {Block} block
         * @returns {Promise<void>}
         * @private
         */
        async _postAccepBlock(block) {
            logger.log(
                `Block ${block.hash()} with ${block.txns.length} TXns and parents ${block.parentHashes} was accepted`
            );
        }

        /**
         * You can add block reward checks here
         *
         * @param {Transaction} tx
         * @param {Number} blockFees
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
         * Build DAG of FINAL blocks! The rest of blocks will be added upon processing INV requests
         *
         */
        async buildMainDag() {
            let arrCurrentLevel = await this._storage.getLastAppliedBlockHashes();
            while (arrCurrentLevel.length) {
                const setNextLevel = new Set();
                for (let hash of arrCurrentLevel) {
                    hash = hash.toString('hex');
                    let bi = this._mainDag.getBlockInfo(hash);
                    if (!bi) bi = await this._storage.getBlockInfo(hash);
                    if (!bi) throw new Error('buildMainDag. Found missed blocks!');
                    if (bi.isBad()) throw new Error(`buildMainDag: found bad block ${hash} in final DAG!`);

                    this._mainDag.addBlock(bi);

                    for (let parentHash of bi.parentHashes) {
                        setNextLevel.add(parentHash);
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
         * @returns {Promise<void>}
         */
        async rebuildPending() {
            const arrHashes = await this._storage.getPendingBlockHashes();
            const mapBlocks = new Map();
            const mapPatches = new Map();
            for (let hash of arrHashes) {
                hash = hash.toString('hex');
                const bi = await this._storage.getBlockInfo(hash);

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

            for (let hash of arrHashes) {
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
            await this._storeBlockAndInfo(block, blockInfo);
        }

        async _blockInFlight(block) {
            const blockInfo = new BlockInfo(block.header);
            blockInfo.markAsInFlight();
            await this._storeBlockAndInfo(block, blockInfo);
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

            this._mainDag.addBlock(blockInfo);
            if (blockInfo.isBad()) {

                // we don't store entire of bad blocks, but store its headers (to prevent processing it again)
                await this._storage.saveBlockInfo(blockInfo);
            } else {

                // save block, and it's info
                await this._storage.saveBlock(block, blockInfo);
            }
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
                    throw new Error(
                        `Block ${block.getHash()} refer to bad parent ${hash}`);
                }

                // parent is not processed yet. block couldn't be executed
                if (!blockInfo) {
                    if (!this._setUnknownBlocks.has(hash)) {

                        // we didn't heard about this block. let's add it for downloading
                        this._setUnknownBlocks.add(hash);
                    }
                }
                result = false;
            }

            // mark block for future processing
            if (!result) await this._blockInFlight(block);
            return result;
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
            console.log('Shutting down');
            process.exit(1);
        }
    };
};

