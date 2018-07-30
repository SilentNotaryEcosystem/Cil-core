const EventEmitter = require('events');
const {sleep} = require('../utils');

module.exports = (({Transport, Constants}) =>
        class Network extends EventEmitter {
            constructor(options) {
                const {arrSeedAddresses, arrDnsSeeds, nMaxPeers, queryTimeout} = options;

                super();
                this._arrSeedAddresses = arrSeedAddresses;
                this._arrDnsSeeds = arrDnsSeeds;

                this._peers = [];
                this._nMaxPeers = nMaxPeers || Constants.MAX_PEERS;
                this._queryTimeout = queryTimeout || Constants.PEER_QUERY_TIMEOUT;
                this._transport = new Transport();
            }

            get myAddress() {
                return this._address;
            }

            async getPeers() {
                const arrDnsPeers = await this._queryDnsRecords(this._arrDnsSeeds);
                this._arrSeedAddresses = this._arrSeedAddresses.concat(arrDnsPeers);
                const arrPeersInfo = await this._querySeedNodes(this._arrSeedAddresses);

                return arrPeersInfo;
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
                for (let name of dnsSeeds) {
                    const arrAddressses = await Transport.resolveName(name);
                    arrResult = arrResult.concat(arrAddressses);
                }

                return arrResult;
            }

            /**
             *
             *
             * @param arrSeedAddresses
             * @return {Promise<Array>} array of PeerInfo
             * @private
             */
            async _querySeedNodes(arrSeedAddresses) {
                let arrResult = [];
                const arrPromises = [];
                for (const addr of arrSeedAddresses) {
                    const peer = this._transport.connect({address: addr});
//                    const prom=peer.requestPeers()
//                        .then(arrPeers => {
//                            arrResult = arrResult.concat(arrPeers);
//                        })
//                        .catch(err => console.error(err));
//                    arrPromises.push(prom);
                }

                // return as much as we get till timeout reached
                await Promise.race([...prom, sleep(this._queryTimeout)]);
                return arrResult;
            }
        }
);
