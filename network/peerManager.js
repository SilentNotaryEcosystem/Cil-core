const EventEmitter = require('events');

module.exports = (Storage, Constants, {PeerInfo}) =>
    class PeerManager extends EventEmitter {
        constructor() {
            super();

            // TODO: add load all peers from persistent store
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
         * @param {Buffer} peerInfo - encoded peerinfo
         */
        discoveredPeer(peerInfo) {

            // TODO: implement timestamps of active peers @see network.proto Address group
            // keys - serialized peerInfo, values - timestamp of last peer action
            this._allPeers.set(peerInfo, Date.now());
        }

        filterPeers({service} = {}) {
            const arrResult = [];
            const tsAlive = Date.now() - Constants.PEER_DEAD_TIME;

            // TODO: подумать над тем как хранить в Map для более быстрой фильтрации
            this._allPeers.forEach((timestamp, peer) => {
                const peerInfo = new PeerInfo(peer);
                if (!service ||
                    ~peerInfo.capabilities.findIndex(nodeCapability => nodeCapability.service === service)) {
                    if (timestamp > tsAlive) {
                        arrResult.push(peerInfo);
                    }
                }
            });

            return arrResult;
        }

        addConnection(connection) {
            this._connectedPeers.push(connection);
            connection.on('message', (message) => {
                this.emit('message', connection, message);
            });
        }
    };
