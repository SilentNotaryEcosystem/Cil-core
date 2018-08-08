const EventEmitter = require('events');

/**
 *
 * @param Storage
 * @param Constants
 * @param PeerInfo
 * @param Peer
 * @return {{new(*=): PeerManager}}
 *
 * @emits 'message' {peer, message}
 */
module.exports = (Storage, Constants, {PeerInfo}, Peer) =>
    class PeerManager extends EventEmitter {
        constructor(options = {}) {
            super();

            const {nMaxPeers} = options;
            this._nMaxPeers = nMaxPeers;

            // TODO: add load all peers from persistent store
            // keys - addesses, values - {timestamp of last peer action, PeerInfo}
            this._allPeers = new Map();
        }

        /**
         *
         * @param {Object | PeerInfo | Peer} peer
         */
        addPeer(peer) {
            if (!(peer instanceof Peer)) peer = new Peer({peerInfo: peer});

            // just bubble message to Node
            peer.on('message', (thisPeer, msg) => this.emit('message', thisPeer, msg));
            this._allPeers.set(this._createKey(peer.address), peer);
            return peer;
        }

        /**
         *
         * @param {Number} service - @see Constants
         * @return {Array} of Peers
         */
        filterPeers({service} = {}) {
            const arrResult = [];
            const tsAlive = Date.now() - Constants.PEER_DEAD_TIME;

            // TODO: подумать над тем как хранить в Map для более быстрой фильтрации
            for (let [, peer] of this._allPeers.entries()) {
                if (!service ||
                    ~peer.capabilities.findIndex(nodeCapability => nodeCapability.service === service)) {
                    if (peer.lastActionTimestamp > tsAlive) {
                        arrResult.push(peer);
                    }
                }
            }

            return arrResult;
        }

        broadcastToConnected() {

        }

        /**
         *
         * @param {Buffer} address
         * @return {string}
         * @private
         */
        _createKey(address) {

            // TODO: implement own key/value store to use binary keys. Maps doesn't work since it's use === operator for keys, now we convert to String. it's memory consuming!
            return address.toString('hex');
        }
    };
