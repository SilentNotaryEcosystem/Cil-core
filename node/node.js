const debugLib = require('debug');
const {sleep} = require('../utils');

const debugNode = debugLib('node:app');
const debugMsg = debugLib('node:messages');

module.exports = (Transport, Messages, Constants, Peer, PeerManager, Storage) => {
    const {MsgCommon, MsgVersion, PeerInfo, MsgAddr} = Messages;

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

            this._peerManager = new PeerManager();
            this._peerManager.on('message', this._incomingMessage.bind(this));

            debugNode(`(address: "${this._debugAddress}") start listening`);
            this._transport.listen();
            this._transport.on('connect', this._incomingConnection.bind(this));
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

            const arrBestPeers = this._findBestPeers();
            for (let peer of arrBestPeers) {
                await this._connectToPeer(peer);
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
            debugNode(`(address: "${this._debugAddress}") connecting to ${address}`);
            return await peer.connect();
        }

        /**
         * Redefine it for WitnessNode, to select only own group
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

        get nonce() {
            return this._nonce;
        }

        _incomingConnection(connection) {
            try {
                debugNode(`(address: "${this._debugAddress}") incoming connection`);
                this._peerManager.addPeer(new Peer({connection}));
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

                debugMsg(`(address: "${this._debugAddress}") received message "${message.message}"`);
                if (message.isVersion()) {
                    return await this._handleVersionMessage(peer, message);
                } else if (message.isVerAck()) {
                    return await this._handleVerackMessage(peer);
                }

                if (!peer.fullyConnected) {
                    logger.error(`Peer ${peer.remoteAddress} missed version handshake stage`);
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
                peer.misbehave(Constants.BAN_PEER_SCORE);
                peer.disconnect();
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

                    // send own version
                    debugMsg(`(address: "${this._debugAddress}") sending own "version"`);
                    await peer.pushMessage(this._createMsgVersion());
                }

                const msgVerack = new MsgCommon();
                msgVerack.verAckMessage = true;
                debugMsg(`(address: "${this._debugAddress}") sending "verack"`);
                await peer.pushMessage(msgVerack);
            } else {
                debugNode(`Has incompatible protocol version ${message.protocolVersion}`);
                peer.disconnect();
            }
        }

        async _handleVerackMessage(peer) {
            if (peer.version) {
                peer.fullyConnected = true;

                // if we initiated connection to peer, so let's ask for known peers
                if (!peer.inbound) {
                    const msgGetAddr = new MsgCommon();
                    msgGetAddr.getAddrMessage = true;
                    debugMsg(`(address: "${this._debugAddress}") sending "getaddr"`);
                    await peer.pushMessage(msgGetAddr);
                } else {
                    debugNode(`(address: "${this._debugAddress}") adding peer ${peer.address} to peerManager`);
                    this._peerManager.addPeer(peer);
                }
            }
        }

        async _handlePeerRequest(peer) {

            // TODO: split array longer than Constants.ADDR_MAX_LENGTH into multiple messages
            const arrPeers = this._peerManager.filterPeers().map(peer => peer.peerInfo.data);
            if (arrPeers.length > Constants.ADDR_MAX_LENGTH) {
                logger.error('Its time to implement multiple addr messages');
            }
            debugMsg(`(address: "${this._debugAddress}") sending "addr" of ${arrPeers.length} items`);
            await peer.pushMessage(new MsgAddr({count: arrPeers.length, peers: arrPeers}));
        }

        async _handlePeerList(peer, message) {
            message = new MsgAddr(message);
            for (let peerInfo of message.peers) {
                const newPeer = this._peerManager.addPeer(peerInfo);
                debugNode(`(address: "${this._debugAddress}") added peer ${newPeer.address} to peerManager`);

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
