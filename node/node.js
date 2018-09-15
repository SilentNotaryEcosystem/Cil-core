const debugLib = require('debug');
const {sleep} = require('../utils');

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
        Block
    } = factory;
    const {MsgCommon, MsgVersion, PeerInfo, MsgAddr, MsgReject, MsgTx, MsgBlock, MsgInv, MsgGetData} = Messages;
    const {MSG_VERSION, MSG_VERACK, MSG_GET_ADDR, MSG_ADDR, MSG_REJECT} = Constants.messageTypes;

    return class Node {
        constructor(options) {
            const {arrSeedAddresses, arrDnsSeeds, nMaxPeers, queryTimeout} = options;

            this._storage = new Storage(options);

            // nonce for MsgVersion to detect connection to self (use crypto.randomBytes + readIn32LE) ?
            this._nonce = parseInt(Math.random() * 100000);

            this._arrSeedAddresses = arrSeedAddresses;
            this._arrDnsSeeds = arrDnsSeeds;

            this._nMaxPeers = nMaxPeers || Constants.MAX_PEERS;
            this._queryTimeout = queryTimeout || Constants.PEER_QUERY_TIMEOUT;
            this._transport = new Transport(options);

            // TODO: requires storage init
            this._mainChain = 0;

            this._myPeerInfo = new PeerInfo({
                capabilities: [
                    {service: Constants.NODE}
                ],
                address: this._transport.myAddress,
                port: this._transport.port
            });

            // used only for debugging purpose. Feel free to remove
            this._debugAddress = this._transport.constructor.addressToString(this._transport.myAddress);

            this._peerManager = new PeerManager({transport: this._transport});
            this._peerManager.on('message', this._incomingMessage.bind(this));

            debugNode(`(address: "${this._debugAddress}") start listening`);
            this._transport.listen();
            this._transport.on('connect', this._incomingConnection.bind(this));

            // create mempool
            this._mempool = new Mempool(options);

            //start RPC
            this._rpc = new RPC(options);
            this._rpc.on('rpc', this._rpcHandler.bind(this));

            this._app = new Application(options);
        }

        get rpc() {
            return this._rpc;
        }

        get nonce() {
            return this._nonce;
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
            for (let peer of arrBestPeers) {
                if (peer.disconnected) await this._connectToPeer(peer);
                await peer.pushMessage(this._createMsgVersion());
                await peer.loaded();
            }

            // TODO: add watchdog to mantain _nMaxPeers connections (send pings cleanup failed connections, query new peers ... see above)
        }

        /**
         *
         * @param {Peer} peer!
         * @return {Promise<*>}
         * @private
         */
        async _connectToPeer(peer) {
            const address = this._transport.constructor.addressToString(peer.address);
            debugNode(`(address: "${this._debugAddress}") connecting to "${address}"`);
            return await peer.connect();
        }

        /**
         *
         * @return {Array} of Peers we decided to be best peers to connect
         * @private
         */
        _findBestPeers() {

            // we prefer witness nodes
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
                if (result !== undefined) return;

                // peer already connected
                const message = new MsgReject({
                    code: Constants.REJECT_DUPLICATE,
                    reason: 'Duplicate connection detected'
                });
                debugMsg(
                    `(address: "${this._debugAddress}") sending message "${message.message}" to "${newPeer.address}"`);
                await newPeer.pushMessage(message);
                newPeer.disconnect();
            } catch (err) {
                logger.error(err);
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
                if (message.isReject()) {
                    const rejectMsg = new MsgReject(message);

                    // connection will be closed by other end
                    logger.log(`Peer: "${peer.address}" rejection reason: "${rejectMsg.reason}"`);

                    // if it's just collision - 1 point not too much, but if peer is malicious - it will raise to ban
                    peer.misbehave(1);
                    peer.loadDone = true;
                    return;
                } else if (message.isVersion()) {
                    return await this._handleVersionMessage(peer, message);
                } else if (message.isVerAck()) {
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
                logger.error(`${err.message} Peer ${peer.remoteAddress}.`);

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

            // we wouldn't check against DB (utxos) here, because it's rather slow
            // this will check for double spend in pending txns
            // if something wrong - it will throw error
            this._processReceivedTx(tx);
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
            try {
                await this._processBlock(msg.block);
            } catch (e) {
                peer.ban();
                throw e;
            }
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

            // we connected to self
            if (message.nonce === this._nonce) {
                debugNode('Connection to self detected. Disconnecting');

                // TODO: should be reviewed, since ban self not only prevent connection to self, but exclude self from advertising it
                peer.ban();
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

                const msgVerack = new MsgCommon();
                msgVerack.verAckMessage = true;
                debugMsg(`(address: "${this._debugAddress}") sending "${MSG_VERACK}" to "${peer.address}"`);
                await peer.pushMessage(msgVerack);
            } else {
                debugNode(`Has incompatible protocol version ${message.protocolVersion}`);
                peer.disconnect();
            }
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
            const arrPeers = this._peerManager.filterPeers().map(peer => peer.peerInfo.data);
            if (arrPeers.length > Constants.ADDR_MAX_LENGTH) {
                logger.error('Its time to implement multiple addr messages');
            }
            debugMsg(`(address: "${this._debugAddress}") sending "${MSG_ADDR}" of ${arrPeers.length} items`);
            await peer.pushMessage(new MsgAddr({count: arrPeers.length, peers: arrPeers}));
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
                debugNode(`(address: "${this._debugAddress}") added peer "${newPeer.address}" to peerManager`);

            }

            // TODO: request block here
            // TODO: move loadDone after we got all we need from peer
            peer.loadDone = true;
        }

        _createMsgVersion() {
            return new MsgVersion({
                nonce: this._nonce,
                peerInfo: this._myPeerInfo.data,
                height: this._mainChain
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
                    this._processReceivedTx(content);
                    break;
            }
        }

        _processReceivedTx(tx) {
            this._mempool.addTx(tx);
            this._informNeighbors(tx);
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
         * @param block
         * @returns {PatchDB | null}
         * @private
         */
        async _processBlock(block) {
            await this._verifyBlock(block);

            const patchState = await this._app.processBlock(block);

            // write raw block to storage
            await this._storage.saveBlock(block);
            await this._storage.applyPatch(patchState);

            this._informNeighbors(block);
        }

        /**
         * Throws error
         * validate block (parents, signatures and so on)
         *
         * @param block
         * @returns {boolean}
         * @private
         */
        async _verifyBlock(block) {

            // TODO: validate block (parents, signatures and so on)
            return true;
        }

    };
};
