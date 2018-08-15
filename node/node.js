const debugLib = require('debug');
const {sleep} = require('../utils');

const debugNode = debugLib('node:app');
const debugMsg = debugLib('node:messages');

module.exports = (Transport, Messages, Constants, Peer, PeerManager, Storage) => {
    const {MsgCommon, MsgVersion, PeerInfo, MsgAddr, MsgReject} = Messages;

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
            const arrBestPeers = this._findBestPeers();
            for (let peer of arrBestPeers) {
                if (peer.disconnected) await this._connectToPeer(peer);
                await peer.pushMessage(this._createMsgVersion());
                await peer.loaded();
            }

            // TODO: add watchdog to mantain _nMaxPeers connections (send pings cleanup failed connections, query new peers ...)
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

                    // connection will be closed by other end
                    logger.log(`Peer: "${peer.remoteAddress}" rejection reason: "${message.reason}"`);

                    // if it's just collision - 1 point not too much, but if peer is broken - it will raise to ban
                    peer.misbehave(1);
                    peer.loadDone = true;
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

                throw new Error(`Unhandled message type "${message.message}"`);
            } catch (err) {
                logger.error(`${err.message} Peer ${peer.remoteAddress}.`);
                peer.misbehave(1);
            }
        }

        /**
         * Handler for 'version' message
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
                    debugMsg(`(address: "${this._debugAddress}") sending own "version" to "${peer.address}"`);
                    await peer.pushMessage(this._createMsgVersion());
                }

                const msgVerack = new MsgCommon();
                msgVerack.verAckMessage = true;
                debugMsg(`(address: "${this._debugAddress}") sending "verack" to "${peer.address}"`);
                await peer.pushMessage(msgVerack);
            } else {
                debugNode(`Has incompatible protocol version ${message.protocolVersion}`);
                peer.disconnect();
            }
        }

        /**
         * Handler for 'verack' message
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
                    debugMsg(`(address: "${this._debugAddress}") sending "getaddr"`);
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
            debugMsg(`(address: "${this._debugAddress}") sending "addr" of ${arrPeers.length} items`);
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
    };
};
