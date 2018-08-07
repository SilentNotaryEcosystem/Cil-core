const debugLib = require('debug');
const {sleep} = require('../utils');

const debugNode = debugLib('node:app');
const debugMsg = debugLib('node:messages');

module.exports = (Transport, Messages, Constants, Peer, PeerManager) => {
    const {MsgCommon, MsgVersion, PeerInfo, MsgAddr} = Messages;

    return class Node {
        constructor(options) {
            const {arrSeedAddresses, arrDnsSeeds, nMaxPeers, queryTimeout} = options;

            // nonce for MsgVersion to detect connection to self
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

            this._peerManager = new PeerManager({nMaxPeers, transport: this._transport});
            this._peerManager.on('message', this._incomingMessage.bind(this));

            debugNode(`(address: "${this._debugAddress}") start listening`);
            this._transport.listen();
            this._transport.on('connect', this._incomingConnection.bind(this));
        }

        async bootstrap() {
            await this._mergeSeedPeers();
            const arrPeerInfo = this._arrSeedAddresses.map(strAddr => new PeerInfo({
                address: this._transport.constructor.strToAddress(strAddr),
                capabilities: [{service: factory.Constants.NODE}]
            }));
            this._peerManager.batchDiscoveredPeers(arrPeerInfo);

            const arrBestPeers = this._findBestPeers();
            for (let peer of arrBestPeers) {
                const connection = await this._connectToPeer(peer);

                const arrPeerInfo = await Promise.race([
                    this._requestPeersFromNode(connection),
                    sleep(this._queryTimeout)
                ]);

                // timeout hit - next peer
                if (!arrPeerInfo) continue;
                await this._peerManager.batchDiscoveredPeers(arrPeerInfo);

                // TODO: blocks download here!
                await this._getBlocks(connection);
            }

            // TODO: add watchdog to mantain _nMaxPeers connections (send pings cleanup failed connections, query new peers ...)
        }

        _getBlocks() {
        }

        /**
         *
         * @param {Object} peerInfo!
         * @return {Promise<*>}
         * @private
         */
        async _connectToPeer(peerInfo) {
            const address = PeerInfo.toAddress(peerInfo.address);
            debugNode(`(address: "${this._debugAddress}") connecting to ${address}`);
            return await this._transport.connect(address, peerInfo.port);
        }

        /**
         * Redefine it for WitnessNode, to select only own group
         *
         * @return {Array} of peerInfo we decided to be best peers to connect
         * @private
         */
        _findBestPeers() {

            // we prefer witness nodes
            const arrWitnessNodes = this._peerManager.filterPeers({service: Constants.WITNESS});
            if (arrWitnessNodes.length) return arrWitnessNodes;

            // but if there is no such - use any nodes
            const arrNodes = this._peerManager.filterPeers({service: Constants.NODE});
            return arrNodes;
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

        /**
         *
         * @param {Connection} connection
         * @return {Promise<Array>} of peers @see msgAddr.peers (deserialized content)
         * @private
         */
        async _requestPeersFromNode(connection) {

            // TODO: proper timeouts handling for receiveSync!
            const msgVersion = new MsgVersion({
                nonce: this._nonce,
                peerInfo: this._myPeerInfo.data,
                height: this._mainChain
            });

            await connection.sendMessage(msgVersion);
            const msgVerAck = await connection.receiveSync();
            debugMsg(`(address: "${this._debugAddress}") got reply "${msgVerAck.message}"`);

            // incompatible peer
            if (!msgVerAck || !msgVerAck.isVerAck()) return [];

            // send getaddr message
            const msgGetAddr = new MsgCommon();
            msgGetAddr.getAddrMessage = true;
            await connection.sendMessage(msgGetAddr);

            let msgAddr;

            // there could be non Addr message - ignore it. 10 attempts will be enough i suppose
            for (let i = 0; i < 10; i++) {
                msgAddr = await connection.receiveSync();
                debugMsg(`(address: "${this._debugAddress}") got reply "${msgAddr.message}"`);

                if (msgAddr.isAddr) break;
            }

            return msgAddr.peers;
        }

        _incomingConnection(connection) {
            debugNode(`(address: "${this._debugAddress}") incoming connection`);
            this._peerManager.addPeer(new Peer({connection}));
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
                    await this._handleVersionMessage(peer, message);
                } else if (message.isVerAck()) {
                    await this._handleVerackMessage(peer);
                } else if (message.isGetAddr()) {
                    await this._handlePeerRequest(peer);
                } else if (message.isAddr()) {
                    await this._handlePeerList(peer, message);
                } else {
                    throw new Error(`Unhandled message type "${message.message}"`);
                }
            } catch (err) {
                logger.error(`Peer ${peer.remoteAddress}. Error ${err.message}`);
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
                peer.version = message.protocolVersion;

                // send own version
                debugMsg(`(address: "${this._debugAddress}") send own "version"`);
                await peer.pushMessage(this._createMsgVersion());
                const msgVerack = new MsgCommon();
                msgVerack.verAckMessage = true;
                debugMsg(`(address: "${this._debugAddress}") send "verack"`);
                await peer.pushMessage(msgVerack);
            } else {
                debugNode(`Has incompatible protocol version ${message.protocolVersion}`);
                peer.disconnect();
            }
        }

        async _handleVerackMessage(peer) {
            peer.fullyConnected = true;
        }

        async _handlePeerRequest(peer) {

            // TODO: split array longer than Constants.ADDR_MAX_LENGTH into multiple messages
            const arrPeers = this._peerManager.filterPeers();
            if (arrPeers.length > Constants.ADDR_MAX_LENGTH) {
                logger.error('Its time to implement multiple addr messages');
            }
            debugMsg(`(address: "${this._debugAddress}") send "addr" of ${arrPeers.length} items`);
            await peer.pushMessage(new MsgAddr({count: arrPeers.length, peers: arrPeers}));
        }

        async _handlePeerList(peer, message) {
            debugMsg(`Peer list:`);
            logger.dir(message, {colors: true, depth: null});
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
