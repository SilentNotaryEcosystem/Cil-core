const EventEmitter = require('events');

module.exports = (Storage, Constants, {PeerInfo}) =>
    class PeerManager extends EventEmitter {
        constructor(options = {}) {
            super();

            const {nMaxPeers} = options;
            this._nMaxPeers = nMaxPeers;

            // TODO: add load all peers from persistent store
            // keys - addesses, values - {timestamp of last peer action, PeerInfo}
            this._allPeers = new Map();

            // TODO: add load banned peers from persistent store
            this._badPeers = new Map();
            this._connectedPeers = [];
        }

        batchDiscoveredPeers(arrPeerInfo) {

            // TODO: add save peers to persistent store
            arrPeerInfo.forEach(peer => this.discoveredPeer(peer));
        }

        /**
         *
         * @param {Object | PeerInfo} peerInfo - @see network.proto PeerInfo
         */
        discoveredPeer(peerInfo) {
            if (peerInfo instanceof PeerInfo) peerInfo = peerInfo.data;

            // TODO: implement timestamps of active peers @see network.proto Address group
            const buffAddress = PeerInfo.addressToBuffer(peerInfo.address);
            // TODO: implement own key/value store to use binary keys. Maps doesn't work since it's use === operator for keys, now we convert to String. it's memory consuming!
            this._allPeers.set(buffAddress.toString('hex'), {timestamp: Date.now(), peerInfo});
        }

        /**
         *
         * @param {Number} service - @see Constants
         * @return {Array} of peerInfo OBJECTS!
         */
        filterPeers({service} = {}) {
            const arrResult = [];
            const tsAlive = Date.now() - Constants.PEER_DEAD_TIME;

            // TODO: подумать над тем как хранить в Map для более быстрой фильтрации
            for (let [peerAddr, {timestamp, peerInfo}] of this._allPeers.entries()) {
                if (!service ||
                    ~peerInfo.capabilities.findIndex(nodeCapability => nodeCapability.service === service)) {
                    if (timestamp > tsAlive) {
                        arrResult.push(peerInfo);
                    }
                }
                if (arrResult.length >= this._nMaxPeers) break;
            }

            return arrResult;
        }

        addConnection(connection) {
            // TODO: replace this._connectedPeers with Map to connect only once to peer
//            const buffAddress = PeerInfo.addressToBuffer(connection.address);

            this._connectedPeers.push(connection);
            connection.on('message', (message) => {
                this.emit('message', connection, message);
            });

        }

        broadcastToConnected() {

        }
    };
