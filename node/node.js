const {sleep} = require('../utils');

module.exports = (Transport, Messages, Constants, PeerManager) => {
    const {MsgCommon, MsgVersion, PeerInfo, MsgAddr} = Messages;

    return class Node {
        constructor(options) {
            const {arrSeedAddresses, arrDnsSeeds, nMaxPeers, queryTimeout} = options;

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
        }

        async bootstrap() {
            await this._mergeSeedPeers();
            this._peerManager.batchDiscoveredPeers(await this._querySeedNodes());
            const arrPeers = this._findBestPeers();
            this._peerManager.connect(arrPeers);
        }

        /**
         * Add DNS peers into this._arrSeedAddresses
         *
         * @return {Promise<void>}
         * @private
         */
        async _mergeSeedPeers() {
            const arrDnsPeers = await this._queryDnsRecords(this._arrDnsSeeds);
            this._arrSeedAddresses = this._arrSeedAddresses.concat(arrDnsPeers);
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
                const prom = this._requestPeersFromNode(addr)
                    .then(arrPeerInfo => {
                        arrResult = arrResult.concat(arrPeerInfo);
                    })
                    .catch(err => logger.error(err));
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
         * We'll query a seed nodes, so we expect listen on default port @see Constants.port
         *
         * @param {String} address
         * @return {Promise<Array>} of peers @see msgAddr.peers (deserialized content)
         * @private
         */
        async _requestPeersFromNode(address) {
            // TODO: proper timeouts handling for receiveSync!

            const timeOutPromise = sleep(this._queryTimeout);
            const connection = await this._transport.connect(address, Constants.port);
            const msgVersion = new MsgVersion({
                peerInfo: this._myPeerInfo.toObject(),
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
            this.connection.close();
            return arrPeers;
        }

        _incomingMessage(connection, message) {
            let resultMsg;
            try {
                if (message.isVersion()) {
                    resultMsg = this._handleVersionMessage(message);
                } else if (message.isAddr()) {
                    resultMsg = this._handleAddrMessage();
                }

                connection.sendMessage(resultMsg).catch(err => logger.error(err));
            } catch (err) {
                logger.error(`Peer ${connection.remoteAddress}. Error ${err.message}`);
            }
        }

        _handleVersionMessage(message) {
            let msg;

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

        _handleAddrMessage() {
            let msg;
            const arrPeers = this._peerManager.filterPeers();

            // TODO: split large arrays into multiple messages
            msg = new MsgAddr({peers: arrPeers});
            return msg;
        }
    };
};
