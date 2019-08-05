const EventEmitter = require('events');
const assert = require('assert');
const Tick = require('tick-tock');

const debug = require('debug')('peerManager:');

/**
 *
 * @param {Factory} factory
 * @return {{new(*=): PeerManager}}
 *
 * @emits 'message' {peer, message}
 */
module.exports = (factory) => {
    const {Constants, Messages, Peer, Transport} = factory;

    const {PeerInfo} = Messages;

    return class PeerManager extends EventEmitter {
        constructor(options = {}) {
            super();
            const {transport, storage, isSeed, strictAddresses} = options;

            // is this PeerManager belongs to seed node? if so - we'll return all peers, even "dead"
            this._isSeed = isSeed;

            this._strictAddresses = strictAddresses || false;

            // to pass it to peers
            this._transport = transport;

            // to store address book
            this._storage = storage;

            // keys - @see _createKey, values - Peers
            this._mapAllPeers = new Map();

            // peers that were build from incoming connection. when we receive handshake with canonical peerInfo
            // we'll associate it. it will allow us remove duplicates (because outbound connections are made from random
            // addresses, but peer has one inbound port)
            this._mapCandidatePeers = new Map();

            // keys - addresses, values - date banned till
            this._mapBannedAddresses = new Map();

            this._backupTimer = new Tick(this);
            this._backupTimer.setInterval(Constants.PEERMANAGER_BACKUP_TIMER_NAME, this._backupTick.bind(this),
                Constants.PEERMANAGER_BACKUP_TIMEOUT
            );
        }

        /**
         * if tag === undefined - return ALL connected peers
         *
         * @param {String | undefined} tag - count only tagged connected peers.
         * @return {Array} of connected peers with specified tag.
         */
        getConnectedPeers(tag) {
            return Array
                .from(this._mapAllPeers.values())
                .reduce((arrPeers, peer) => {
                    if (!peer.disconnected && peer.hasTag(tag)) arrPeers.push(peer);
                    return arrPeers;
                }, []);
        }

        /**
         *
         * @param {Object | PeerInfo | Peer} peer
         * @param {Boolean} bForceRewrite - if we already have this peer, will we rewrite it or no?
         * @return {Peer | undefined} undefined if peer already connected
         */
        addPeer(peer, bForceRewrite) {
            if (!(peer instanceof Peer)) peer = new Peer({peerInfo: peer, transport: this._transport});

            // it's senseless to store peer with private addresses. we couldn't connect them anyway
            if (!Transport.isRoutableAddress(peer.address)) {
                return peer;
            }

            const key = this._createKey(peer.address, peer.port);
            const existingPeer = this._mapAllPeers.get(key);

            if (existingPeer && existingPeer.isBanned()) return Constants.REJECT_BANNED;
            if (existingPeer && existingPeer.isRestricted()) return Constants.REJECT_RESTRICTED;

            // both peers are connected.
            if (existingPeer && !existingPeer.disconnected && !peer.disconnected) return Constants.REJECT_DUPLICATE;

            // we'll keep existing info (only for disconnected existing peers)
            if (existingPeer && !bForceRewrite) return existingPeer;

            if (existingPeer) existingPeer.removeAllListeners();
            this.updateHandlers(peer);
            this.emit('newPeer', peer);

            this._mapAllPeers.set(key, peer);
            return peer;
        }

        /**
         * It's a part of mechanism that will keep only "canonical" (which node listens) addresses
         * while incoming connections have random ports
         *
         * @param {Connection} connection - TCP connection
         */
        addCandidateConnection(connection) {
            assert(!this.isBannedAddress(connection.remoteAddress), 'You are banned');

            const newPeer = new Peer({connection, transport: this._transport});
            const key = this._createKey(newPeer.address, newPeer.port);

            this.updateHandlers(newPeer);
            this._mapCandidatePeers.set(key, newPeer);
        }

        /**
         * It's a part of mechanism that will keep only "canonical" (which node listens) addresses
         * while incoming connections have random ports
         *
         * @param {Peer} peer - connected peer
         * @param {PeerInfo} peerInfo - from MSG_VERSION
         * @returns {Peer | Number}
         */
        associatePeer(peer, peerInfo) {
            const keyCandidate = this._createKey(peer.address, peer.port);
            assert(this._mapCandidatePeers.get(keyCandidate), 'Unexpected peer not found in candidates!');

            const cPeerInfo = new PeerInfo(peerInfo);
            if (this._strictAddresses) {
                assert(peer.peerInfo.address.equals(cPeerInfo.address), 'Peer tries to forge its address!');
            }

            // TODO rethink "canonical" addresses for multihome nodes
            peer.updatePeerFromPeerInfo(peerInfo);
            this._mapCandidatePeers.delete(keyCandidate);

            return this.addPeer(peer, true);
        }

        storeOutboundPeer(peer, peerInfo) {
            peer.peerInfo.port = peerInfo.port;
            peer.capabilities = peerInfo.port;
        }

        /**
         *
         * @param {String} strAddress
         * @returns {boolean}
         */
        isBannedAddress(strAddress) {
            const msecBannedTill = this._mapBannedAddresses.get(strAddress);
            return msecBannedTill > Date.now();
        }

        removePeer(peer) {
            if (!(peer instanceof Peer)) peer = new Peer({peerInfo: peer, transport: this._transport});
            const key = this._createKey(peer.address, peer.port);
            const foundPeer = this._mapAllPeers.get(key);
            if (foundPeer) {
                foundPeer.removeAllListeners();
                if (!peer.disconnected) foundPeer.disconnect();
            }
            this._mapAllPeers.delete(key);
        }

        hasPeer(peer) {
            if (!(peer instanceof Peer)) peer = new Peer({peerInfo: peer, transport: this._transport});
            const key = this._createKey(peer.address, peer.port);
            return this._mapAllPeers.has(key);
        }

        updateHandlers(peer) {
            if (!peer.listenerCount('message')) peer.on('message', this._incomingMessage.bind(this));

            if (peer.isWitness && !peer.listenerCount('witnessMessage')) {
                peer.on('witnessMessage', this._incomingMessage.bind(this));
            }
            if (!peer.listenerCount('disconnect')) peer.on('disconnect', this._peerDisconnect.bind(this));
            if (!peer.listenerCount('peerBanned')) peer.on('peerBanned', this._peerBaned.bind(this));
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

        _peerBaned(peer) {
            this._mapBannedAddresses.set(peer.address, peer.bannedTill);
        }

        _peerDisconnect(thisPeer) {
            this.emit('disconnect', thisPeer);
        }

        /**
         * Return only alive & not banned peers
         *
         * @param {Number} service - @see Constants
         * @param {Boolean} bIncludeInactive - whether include long time inactive peers or not
         * @return {Array} of Peers
         */
        filterPeers({service} = {}, bIncludeInactive = false) {
            const arrResult = [];

            // TODO: подумать над тем как хранить в Map для более быстрой фильтрации
            for (let [, peer] of this._mapAllPeers.entries()) {
                if (!service || ~peer.capabilities.findIndex(nodeCapability => nodeCapability.service === service)) {

                    if (!peer.isBanned() &&
                        (bIncludeInactive || this._isSeed || (peer.isAlive() && !peer.isRestricted()))) {
                        arrResult.push(peer);
                    }
                }
            }

            return arrResult;
        }

        findBestPeers() {
            return Array.from(this._mapAllPeers.values())
                .sort((a, b) => b.quality - a.quality)
                .slice(0, Constants.MAX_PEERS);
        }

        broadcastToConnected(tag, message) {
            const arrPeers = this.getConnectedPeers(tag);
            debug(`Found ${arrPeers.length} connected peers for tag "${tag}"`);
            for (let peer of arrPeers) {
                peer.pushMessage(message).catch(err => logger.error(err));
            }
        }

        async loadPeers() {
            const arrPeers = await this._storage.loadPeers();
            arrPeers.forEach(peer => this.addPeer(peer, true));
            return arrPeers;
        }

        async savePeers(arrPeers) {
            return await this._storage.savePeers(arrPeers);
        }

        async saveAllPeers() {
            const arrPeers = Array.from(this._mapAllPeers.values());
            if (arrPeers.length) {
                await this.savePeers(arrPeers);
            }
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

        _backupTick() {
            this.saveAllPeers();
        }
    };
};
