const EventEmitter = require('events');

/**
 *
 * @param {Factory} factory
 * @return {{new(*=): PeerManager}}
 *
 * @emits 'message' {peer, message}
 */
module.exports = (factory) => {
    const {Storage, Constants, Messages, Peer} = factory;

    const {PeerInfo} = Messages;

    return class PeerManager extends EventEmitter {
        constructor(options = {}) {
            super();
            const {transport} = options;

            this._transport = transport;
            this._storage = new Map(); //new Storage(options);
            // TODO: add load all peers from persistent store
            // keys - addesses, values - {timestamp of last peer action, PeerInfo}
            this._allPeers = new Map();
        }

        /**
         * if tag === undefined - return ALL connected peers
         *
         * @param {String | undefined} tag - count only tagged connected peers.
         * @return {Array} of connected peers with specified tag.
         */
        connectedPeers(tag) {
            return Array
                .from(this._allPeers.values())
                .reduce((arrPeers, peer) => {
                    if (!peer.disconnected && peer.hasTag(tag)) arrPeers.push(peer);
                    return arrPeers;
                }, []);
        }

        /**
         *
         * @param {Object | PeerInfo | Peer} peer
         * @return {Peer | undefined} undefined if peer already connected
         */
        async addPeer(peer) {

            // TODO: do we need mutex support here?

            if (!(peer instanceof Peer)) peer = new Peer({peerInfo: peer, transport: this._transport});
            const key = this._createKey(peer.address, peer.port);
            const existingPeer = this._allPeers.get(key);

            if (existingPeer && existingPeer.banned) return Constants.REJECT_BANNED;

            if (existingPeer && !existingPeer.disconnected && !peer.disconnected) {
                return Constants.REJECT_DUPLICATE;
            }

            if (existingPeer && existingPeer.tempBannedAddress) return Constants.REJECT_BANNEDADDRESS;
            // we connected to that peer so we believe that this info more correct
            if (existingPeer && (existingPeer.version || !existingPeer.disconnected)) return existingPeer;

            this.updateHandlers(peer);


            // TODO: emit new peer
            this._allPeers.set(key, peer);
            return peer;
        }

        updateHandlers(peer) {
            if (!peer.listenerCount('message')) peer.on('message', this._incomingMessage.bind(this));
            if (peer.isWitness && !peer.listenerCount('witnessMessage')) {
                peer.on('witnessMessage', this._incomingMessage.bind(this));
            }
            if (!peer.listenerCount('disconnect')) peer.on('disconnect', this._peerDisconnect.bind(this));
        }

        /**
         *
         * @param {Peer} thisPeer
         * @param {MessageCommon | undefined} msg - undefined means - wrong signature check
         * @private
         */
        _incomingMessage(thisPeer, msg) {

            // just bubble message to Node
            if (!msg || msg.signature) {
                this.emit('witnessMessage', thisPeer, msg);
            } else {
                this.emit('message', thisPeer, msg);
            }
        }

        _peerDisconnect(thisPeer) {
            this.emit('disconnect', thisPeer);
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
                if (!service || ~peer.capabilities.findIndex(nodeCapability => nodeCapability.service === service)) {
                    if (!peer.banned && peer.lastActionTimestamp > tsAlive) {
                        arrResult.push(peer);
                    }
                }
            }

            return arrResult;
        }

        findBestPeers() {
            return Array.from(this._allPeers.values())
                .sort((a, b) => b.quality - a.quality)
                .slice(0, Constants.MAX_PEERS);
        }

        broadcastToConnected(tag, message) {
            const arrPeers = this.connectedPeers(tag);
            for (let peer of arrPeers) {
                peer.pushMessage(message).catch(err => logger.error(err));
            }
        }

        async hasPeer(address) {
            typeforce.oneOf(typeforce.Address, String);

            try {
                await this.getPeer(address);
                return true;
            } catch (e) {
                return false;
            }
        }
        async getPeer(address) {
            //
            //typeforce.oneOf(typeforce.Address, String);

            const strAddress = Buffer.isBuffer(address) ? Transport.addressToString(address) : address;
            const peerInfo = this._storage.get(strAddress);
            if (!peerInfo) throw new Error(`Storage: No peer found by address ${strAddress}`);

            return new Peer({peerInfo});
        }

        async savePeer(peer) {
            const key = Buffer.isBuffer(peer.address) ? Transport.addressToString(peer.address) : peer.address;
            peer.saveLifetimeCounters();
            this._storage.set(key, peer.peerInfo.encode());
        }

        async loadPeers() {
            let arrPeers = [];
            for (let p of this._storage.values()) {
                arrPeers.push(new Peer({peerInfo: p}));
            }
            return arrPeers;
        }

        async savePeers(arrPeers) {
            for (let peer of arrPeers)
                this.savePeer(peer)
        }

        async saveAllPeers() {
            return await this.savePeers(Array.from(this._allPeers.values()));
        }
        /**
         *
         * @param {Buffer} address
         * @param {Number} port
         * @return {string}
         * @private
         */
        _createKey(address, port) {

            // TODO: implement own key/value store to use binary keys. Maps doesn't work since it's use === operator for keys, now we convert to String. it's memory consuming!
            // it could be ripemd160
            return address + port.toString();
        }
    };
};
