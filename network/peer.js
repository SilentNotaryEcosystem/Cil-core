const EventEmitter = require('events');
const debug = require('debug')('peer:');
const {sleep} = require('../utils');

/**
 * Хранит информацию о Peer'е
 * - для хранения состояния peer'а при обработке сообщений
 *
 * @emits 'message' {this, message}
 */

module.exports = ({PeerInfo}, Transport, Constants) =>
    class Peer extends EventEmitter {
        constructor(options = {}) {
            super();
            const {connection, peerInfo, lastActionTimestamp} = options;

            this._transport = new Transport(options);
            this._handshakeDone = false;
            this._version = undefined;
            this._missbehaveScore = 0;
            this._missbehaveTime = Date.now();
            this._lastActionTimestamp = lastActionTimestamp ? lastActionTimestamp : Date.now();

            // this means that we have incoming connection
            if (connection) {
                this._connection = connection;
                this._bInbound = true;
                this._setMessageHandler();
                this._peerInfo = new PeerInfo({
                    address: connection.remoteAddress
                });
            } else if (peerInfo) {
                this.peerInfo = peerInfo;
            } else {
                throw new Error('Pass connection or peerInfo to create peer');
            }
        }

        get peerInfo() {
            return this._peerInfo;
        }

        set peerInfo(peerInfo) {
            if (peerInfo instanceof PeerInfo) {
                this._peerInfo = peerInfo;
            } else {
                this._peerInfo = new PeerInfo(peerInfo);
            }
        }

        get address() {
            return this._peerInfo.address;
        }

        get port() {
            return this._peerInfo ? this._peerInfo.port : undefined;
        }

        get capabilities() {
            return this._peerInfo.capabilities;
        }

        get isWitness() {
            return Array.isArray(this._peerInfo.capabilities) &&
                   this._peerInfo.capabilities.find(cap => cap.service === Constants.WITNESS);
        }

        get publicKey() {
            if (!this.isWitness) throw new Error('This peer has no witness capability');
            const witnessCap = this._peerInfo.capabilities.find(cap => cap.service === Constants.WITNESS);
            return witnessCap.data;
        }

        get lastActionTimestamp() {
            return this._lastActionTimestamp;
        }

        get disconnected() {
            return !this._connection;
        }

        get banned() {
            return this._bBanned;
        }

        get inbound() {
            return this._bInbound;
        }

        get version() {
            return this._version;
        }

        set version(ver) {
            this._version = ver;
        }

        get fullyConnected() {
            return !this.disconnected && this._handshakeDone;
        }

        set fullyConnected(trueVal) {
            this._handshakeDone = true;
        }

        get loadDone() {
            return this._loadDone;
        }

        set loadDone(trueVal) {
            this._loadDone = true;
        }

        async loaded() {
            for (let i = 0; i < Constants.PEER_QUERY_TIMEOUT / 100; i++) {
                await sleep(100);
                if (this.loadDone) break;
            }
        }

        async connect() {
            if (!this.disconnected) {
                debug(`Peer ${this.address} already connected`);
                return;
            }
            this._connection = await this._transport.connect(this.address, this.port);
            this._setMessageHandler();
        }

        _setMessageHandler() {
            this._connection.on('message', msg => {

                // TODO: update counters/timers here
                this._lastActionTimestamp = Date.now();
                this.emit('message', this, msg);
            });
        }

        async pushMessage(msg) {
            // we have pending messages
            if (Array.isArray(this._queue)) {
                debug('Queue message');
                this._queue.push(msg);
                return;
            } else {
                this._queue = [msg];
                let nextMsg;
                while ((nextMsg = this._queue.shift())) {
                    debug(`Sending message "${nextMsg.message}" to ${Transport.addressToString(this.address)}`);
                    await this._connection.sendMessage(nextMsg);
                }
                this._queue = undefined;
            }
        }

        banPeer() {
            this._bannedTill = new Date(Date.now() + Constants.BAN_PEER_TIME);
            this._bBanned = true;
        }

        misbehave(score) {

            // reset _missbehaveScore if it was Constants.BAN_PEER_TIME ago
            if (Date.now() - this._missbehaveTime > Constants.BAN_PEER_TIME) this._missbehaveScore = 0;

            this._missbehaveScore += score;
            this._missbehaveTime = Date.now();
            if (this._missbehaveScore >= Constants.BAN_PEER_SCORE) this.banPeer();
        }

        disconnect() {
            this._connection.close();
            this._connection = undefined;
        }

    };
