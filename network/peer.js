const EventEmitter = require('events');
const debug = require('debug')('peer:');
const {sleep} = require('../utils');

/**
 * Хранит информацию о Peer'е
 * - для хранения состояния peer'а при обработке сообщений
 *
 * @emits 'message' {this, message}
 */

module.exports = (factory) => {
    const {Messages, Transport, Constants} = factory;
    const {PeerInfo} = Messages;
    return class Peer extends EventEmitter {
        constructor(options = {}) {
            super();
            const {connection, peerInfo, lastActionTimestamp, transport} = options;

            this._nonce = parseInt(Math.random() * 100000);

            this._transport = transport ? transport : new Transport(options);
            this._handshakeDone = false;
            this._version = undefined;
            this._missbehaveScore = 0;
            this._missbehaveTime = Date.now();
            this._lastActionTimestamp = lastActionTimestamp ? lastActionTimestamp : Date.now();

            this._tags = [];

            // this means that we have incoming connection
            if (connection) {
                this._connection = connection;
                this._bInbound = true;
                this._setConnectionHandlers();
                this._peerInfo = new PeerInfo({
                    address: connection.remoteAddress
                });
            } else if (peerInfo) {
                this.peerInfo = peerInfo;
            } else {
                throw new Error('Pass connection or peerInfo to create peer');
            }

            // TODO: add watchdog to unban peers
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

        get publicKey() {
            if (!this.isWitness) throw new Error('This peer has no witness capability');
            const witnessCap = this._peerInfo.capabilities.find(cap => cap.service === Constants.WITNESS);
            return witnessCap.data;
        }

        get witnessLoadDone() {
            return this._witnessLoadDone;
        }

        set witnessLoadDone(trueVal) {
            this._witnessLoadDone = true;
        }

        addTag(tag) {
            this._tags.push(tag);
        }

        hasTag(tag) {

            // if tag === undefined - return true!
            return !tag || this._tags.includes(tag);
        }

        async loaded() {
            for (let i = 0; i < Constants.PEER_QUERY_TIMEOUT / 100; i++) {
                await sleep(100);
                if (this.loadDone) break;
            }
        }

        async witnessLoaded() {
            for (let i = 0; i < Constants.PEER_QUERY_TIMEOUT / 100; i++) {
                await sleep(100);
                if (this.witnessLoadDone) break;
            }
        }

        async connect() {
            if (this.banned) {
                logger.error('Trying to connect to banned peer!');
                return;
            }
            if (!this.disconnected) {
                debug(`Peer ${this.address} already connected`);
                return;
            }
            this._connection = await this._transport.connect(this.address, this.port);
            this._setConnectionHandlers();
        }

        _setConnectionHandlers() {
            if (!this._connection.listenerCount('message')) {
                this._connection.on('message', msg => {

                    // TODO: update counters/timers here
                    this._lastActionTimestamp = Date.now();
                    if (msg.signature) {

                        // if message signed: check signature
                        if (this.isWitness && msg.verifySignature(this.publicKey)) {
                            this.emit('witnessMessage', this, msg);
                        } else {
                            this.emit('witnessMessage', this, undefined);
                        }
                    } else {
                        this.emit('message', this, msg);
                    }
                });

                this._connection.on('close', () => {
                    debug(`Connection to "${this.address}" closed`);
                    this._bInbound = false;
                    this.loadDone = true;
                    this._connection = undefined;
                });
            }
        }

        // TODO: for MsgGetData - make a cache for already requested hashes!
        async pushMessage(msg) {
            // we have pending messages
            if (Array.isArray(this._queue)) {
                debug(`Queue message "${msg.message}" to "${Transport.addressToString(this.address)}"`);
                this._queue.push(msg);
            } else {
                this._queue = [msg];
                let nextMsg;
                while ((nextMsg = this._queue.shift())) {
                    debug(`Sending message "${nextMsg.message}" to "${Transport.addressToString(this.address)}"`);
                    await this._connection.sendMessage(nextMsg);
                }
                this._queue = undefined;
            }
        }

        ban() {
            this._bannedTill = new Date(Date.now() + Constants.BAN_PEER_TIME);
            this._bBanned = true;

            debug(`Peer "${this._address}" banned till ${new Date(this._bannedTill)}`);

            if (!this.disconnected) this.disconnect();
        }

        misbehave(score) {

            // reset _missbehaveScore if it was Constants.BAN_PEER_TIME ago
            if (Date.now() - this._missbehaveTime > Constants.BAN_PEER_TIME) this._missbehaveScore = 0;

            this._missbehaveScore += score;
            this._missbehaveTime = Date.now();
            if (this._missbehaveScore >= Constants.BAN_PEER_SCORE) this.ban();
        }

        disconnect() {
            debug(`Closing connection to "${this._connection.remoteAddress}"`);
            this._connection.close();
        }

    };
};
