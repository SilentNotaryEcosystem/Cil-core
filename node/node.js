const {sleep} = require('../utils');

module.exports = (Transport, Messages, Constants, PeerManager) => {
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

            this._myPeerInfo = new PeerInfo({
                capabilities: [
                    {service: Constants.NODE}
                ]
            });
            this._myPeerInfo.address = this._transport.myAddress;
            this._peerManager = new PeerManager();
            this._peerManager.on('message', this._incomingMessage.bind(this));

            this._transport.listen();
            this._transport.on('connect', this._incomingConnection.bind(this));
        }

        async bootstrap() {
            await this._mergeSeedPeers();
            this._peerManager.batchDiscoveredPeers(await this._querySeedNodes(this._arrSeedAddresses));
            const arrPeers = this._findBestPeers();
            let count = 0;
            for (const peerInfo of arrPeers) {

                // TODO: for WitnessNode use _nMaxPeers as size of group
                if (count++ < this._nMaxPeers) break;
                this._transport.connect(peerInfo.address, peerInfo.port)
                    .then(() => this._requestPeersFromNode(connection))
                    .then((arrPeerInfo) => this._peerManager.batchDiscoveredPeers(arrPeerInfo))

                    // TODO: blocks download here!
                    .then(() => this._getBlocks(connection))
                    .catch(err => console.error(err));
            }

            // TODO: add watchdog to mantain _nMaxPeers connections (send pings cleanup failed connections ...)
        }

        /**
         * Redefine it for WitnessNode, to select only own group
         *
         * @return {Array} of peerInfo we decided to be best peers to connect
         * @private
         */
        _findBestPeers() {
            return this._peerManager.filterPeers({service: Constants.WITNESS});
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
         *
         * @param {Array} arrSeedAddresses - addresses of seed nodes
         * @return {Promise<Array>} array of PeerInfo
         * @private
         */
        async _querySeedNodes(arrSeedAddresses) {
            let arrResult = [];

            // TODO: proper timeouts handling!
            // TODO: implement not such greedy query (see commented below)
            const arrPromises = [];
            for (const addr of arrSeedAddresses) {
                const connection = await this._transport.connect(addr, Constants.port);
                const prom = this._requestPeersFromNode(connection)
                    .then(arrPeerInfo => {
                        arrResult = arrResult.concat(arrPeerInfo);
                    })
                    .catch(err => logger.error(err))
                    .then(() => connection.close());
                arrPromises.push(prom);
            }
            await Promise.all(arrPromises);

//            const arrPromises = [];
//            for (const addr of arrSeedAddresses) {
//                const peer = this._transport.connect({address: addr});
//                    const prom=peer.requestPeers()
//                        .then(arrPeers => {
//                            arrResult = arrResult.concat(arrPeers);
//                        })
//                        .catch(err => logger.error(err));
//                    arrPromises.push(prom);
//            }

            // return as much as we get till timeout reached
//            await Promise.race([...prom, sleep(this._queryTimeout)]);
            return arrResult;
        }

        /**
         *
         * @param {String} address
         * @return {Promise<Array>} of peers @see msgAddr.peers (deserialized content)
         * @private
         */
        async _requestPeersFromNode(connection) {
            // TODO: proper timeouts handling for receiveSync!

            const timeOutPromise = sleep(this._queryTimeout);
            const msgVersion = new MsgVersion({
                nonce: this._nonce,
                peerInfo: this._myPeerInfo.data,
                height: this._height
            });

            await connection.sendMessage(msgVersion);
            const msgVerAck = await connection.receiveSync();

            // incompatible peer
            if (!msgVerAck || !msgVerAck.isVerAck()) return [];

            // send getaddr message
            const msgGetAddr = new MsgCommon();
            msgGetAddr.getAddrMessage = true;
            await connection.sendMessage(msgGetAddr);

            let arrPeers = [];

            // TODO: proper multimessage response handling within timeout not just 10 messages
            for (let i = 0; i < 10; i++) {
                connection.receiveSync()
                    .then(msgAddr => {

                        // there could be non Addr message - ignore it
                        if (msgAddr.isAddr) {
                            arrPeers = arrPeers.concat(msgAddr.peers);
                        }
                    })
                    .catch(err => logger.error(err));

            }
            await timeOutPromise;
            connection.close();
            return arrPeers;
        }

        _incomingConnection(connection) {
            this._peerManager.addConnection(connection);
        }

        _incomingMessage(connection, message) {
            let resultMsg;
            try {
                if (message.isVersion()) {
                    resultMsg = this._handleVersionMessage(message);

                    // we'r connected to self
                    if (!resultMsg) {
                        logger.log('Closing connection to self');
                        connection.close();
                    }
                } else if (message.isGetAddr()) {
                    resultMsg = this._handlePeerRequest();
                } else if (message.isAddr()) {
                    resultMsg = this._handlePeerList(message);
                } else {
                    throw new Error(`Unhandled message type ${message.message}`);
                }

                connection.sendMessage(resultMsg).catch(err => logger.error(err));
            } catch (err) {
                logger.error(`Peer ${connection.remoteAddress}. Error ${err.message}`);
            }
        }

        _handleVersionMessage(message) {
            let msg;

            // we connected to self
            if (message.nonce === this._nonce) return null;

            // TODO: review version compatibility
            if (message.protocolVersion >= Constants.protocolVersion) {
                msg = new MsgCommon();
                msg.verAckMessage = true;

                // peer is compatible, let's add it to our address book
                this._peerManager.discoveredPeer(message.peerInfo);
            } else {
                throw new Error(`Has incompatible protocol version ${message.protocolVersion}`);
            }
            return msg;
        }

        _handlePeerList(message) {
            logger.log(`Peer list:`);
            logger.dir(message, {colors: true, depth: null});
        }

        _handlePeerRequest() {
            let msg;
            const arrPeers = this._peerManager.filterPeers();

            // TODO: split large arrays into multiple messages
            msg = new MsgAddr({peers: arrPeers});
            return msg;
        }
    };
};
