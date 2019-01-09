const EventEmitter = require('events');
const debug = require('debug')('peer:');
const {sleep} = require('../utils');
const Tick = require('tick-tock');

/**
 * Хранит информацию о Peer'е
 * - для хранения состояния peer'а при обработке сообщений
 *
 * @emits 'message' {this, message}
 */

module.exports = (factory) => {
    const {Messages, Transport, Constants} = factory;
    const {
        MsgCommon,
        PeerInfo
    } = Messages;
    //const {PeerInfo} = Messages;
    const PEER_TIMER_NAME = 'peerTimer';
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
            this._transmittedBytes = 0;
            this._receivedBytes = 0;
            this._msecOffsetDelta = 0;
            this._lastDisconnectedAddress = undefined;
            this._lastDisconnectionTime = undefined;

            this._persistent = false;

            // this means that we have incoming connection
            if (connection) {
                this._connection = connection;
                this._bInbound = true;
                this._setConnectionHandlers();
                this._peerInfo = new PeerInfo({
                    address: Transport.strToAddress(connection.remoteAddress),
                    port: connection.remotePort
                });
                this._connectedTill = new Date(Date.now() + Constants.PEER_CONNECTION_LIFETIME);
            } else if (peerInfo) {
                this.peerInfo = peerInfo;
            } else {
                throw new Error('Pass connection or peerInfo to create peer');
            }

            this._tock = new Tick(this);
            this._tock.setInterval(PEER_TIMER_NAME, this._tick.bind(this), Constants.PEER_TICK_TIMEOUT);

            this._deadTimer = new Tick(this);
            this._deadTimer.setInterval(Constants.PEER_DEAD_TIMER_NAME, this._deadTick.bind(this),
                Constants.PEER_DEAD_TIMEOUT
            );

            this._pingTimer = new Tick(this);
            this._pingTimer.setInterval(Constants.PEER_PING_TIMER_NAME, this._pingTick.bind(this),
                Constants.PEER_PING_TIMEOUT
            );

        }

        get amountBytes() {
            return this._transmittedBytes + this._receivedBytes;
        }

        get missbehaveScore() {
            return this._missbehaveScore;
        }

        get transmittedBytes() {
            return this._transmittedBytes;
        }

        get receivedBytes() {
            return this._receivedBytes;
        }

        /**
         * witness peers shouldn't be disconnected
         */
        markAsPersistent() {
            this._persistent = true;
        }

        get tempBannedAddress() {
            return !!this._lastDisconnectedAddress
                   && this._lastDisconnectedAddress === this.address
                   && Date.now() - this._lastDisconnectionTime < Constants.PEER_BANADDRESS_TIME;
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

        /**
         *
         * @returns {String} !!!
         */
        get address() {
            return Transport.addressToString(this._peerInfo.address);
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

        get offsetDelta() {
            return this._msecOffsetDelta;
        }

        set offsetDelta(delta) {
            this._msecOffsetDelta = delta;
        }

        get quality() {
            return (this._peerInfo.lifetimeReceivedBytes + this._peerInfo.lifetimeTransmittedBytes + this.amountBytes)
                   / (this._peerInfo.lifetimeMisbehaveScore + this.missbehaveScore + 1);
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
            if (this.tempBannedAddress) {
                logger.error('Trying to connect to banned address!');
                return;
            }
            if (!this.disconnected) {
                logger.error(`Peer ${this.address} already connected`);
                return;
            }
            this._transmittedBytes = 0;
            this._receivedBytes = 0;
            this._connection = await this._transport.connect(this.address, this.port);
            this._connectedTill = new Date(Date.now() + Constants.PEER_CONNECTION_LIFETIME);
            this._setConnectionHandlers();
        }

        _setConnectionHandlers() {
            if (!this._connection.listenerCount('message')) {
                this._connection.on('message', async (msg) => {

                    // count incoming bytes
                    if (msg.payload && Buffer.isBuffer(msg.payload)) {
                        this._receivedBytes += msg.payload.length;
                        if (!this._persistent && this.amountBytes > Constants.PEER_MAX_BYTESCOUNT) {
                            this.disconnect(`Limit "${Constants.PEER_MAX_BYTESCOUNT}" bytes reached for peer`);
                        }
                    }
                    this._lastActionTimestamp = Date.now();

                    if (msg.signature) {

                        // if message signed: check signature
                        if (this.isWitness && msg.verifySignature(this.publicKey)) {
                            this.emit('witnessMessage', this, msg);
                        } else {
                            this.emit('witnessMessage', this, undefined);
                        }
                    } else if (new MsgCommon(msg).isPing()) {
                        const msgPong = new MsgCommon();
                        msgPong.pongMessage = true;
                        await this.pushMessage(msgPong);
                    } else {
                        this.emit('message', this, msg);
                    }
                });

                this._connection.on('close', () => {
                    debug(`Connection to "${this.address}" closed`);
                    this._cleanup();
                    this._lastDisconnectedAddress = this.address;
                    this._lastDisconnectionTime = Date.now();
                    this._peerInfo.lifetimeMisbehaveScore += this._missbehaveScore;
                    this._peerInfo.lifetimeTransmittedBytes += this._transmittedBytes;
                    this._peerInfo.lifetimeReceivedBytes += this._receivedBytes;
                    this._connection = undefined;
                    this.emit('disconnect', this);
                });
            }
        }

        // TODO: for MsgGetData - make a cache for already requested hashes!
        async pushMessage(msg) {

            // we have pending messages
            if (Array.isArray(this._queue)) {
                debug(`Queue message "${msg.message}" to "${this.address}"`);
                this._queue.push(msg);
            } else {
                this._queue = [msg];
                let nextMsg;
                while ((nextMsg = this._queue.shift())) {
                    debug(`Sending message "${nextMsg.message}" to "${this.address}"`);

                    // possibly, peer was disconnected between messages
                    if (this._connection && typeof this._connection.sendMessage === 'function') {
                        await this._connection.sendMessage(nextMsg);
                    }
                    if (nextMsg.payload && Buffer.isBuffer(nextMsg.payload)) {
                        this._transmittedBytes += nextMsg.payload.length;
                    }
                }
                this._queue = undefined;

                // count outgoing bytes
                if (!this._persistent && this.amountBytes > Constants.PEER_MAX_BYTESCOUNT) {
                    this.disconnect(`Limit "${Constants.PEER_MAX_BYTESCOUNT}" bytes reached for peer`);
                }
            }
        }

        ban() {
            this._bannedTill = new Date(Date.now() + Constants.BAN_PEER_TIME);
            this._bBanned = true;

            debug(`Peer banned till ${new Date(this._bannedTill)}`);

            if (!this.disconnected) this.disconnect('Peer banned');
        }

        misbehave(score) {

            // reset _missbehaveScore if it was Constants.BAN_PEER_TIME ago
            if (Date.now() - this._missbehaveTime > Constants.BAN_PEER_TIME) this._missbehaveScore = 0;

            this._missbehaveScore += score;
            this._missbehaveTime = Date.now();
            if (this._missbehaveScore >= Constants.BAN_PEER_SCORE) this.ban();
        }

        disconnect(reason) {
            debug(`${reason}. Closing connection to "${this._connection.remoteAddress}"`);
            try {
                this._connection.close();
            } catch (err) {
                logger.error(err);
            }
            this._connection = undefined;
            this.emit('disconnect', this);
        }

        saveLifetimeCounters() {
            this.peerInfo.lifetimeMisbehaveScore = this._missbehaveScore;
            this.peerInfo.lifetimeTransmittedBytes = this._transmittedBytes;
            this.peerInfo.lifetimeReceivedBytes = this._receivedBytes;
        }

        _cleanup() {
            this._bInbound = false;
            this.loadDone = true;
            this._transmittedBytes = 0;
            this._receivedBytes = 0;

            this._msecOffsetDelta = 0;
        }

        _tick() {
            if (this._bBanned && this._bannedTill.getTime() < Date.now()) {
                this._bBanned = false;
            }

            // disconnect non persistent peers when time has come
            if (!this._persistent && !this.disconnected && this._connectedTill.getTime() < Date.now()) {
                this.disconnect('Scheduled disconnect');
            }
        }

        _deadTick() {
            if (!this.disconnected && Date.now() - this._lastActionTimestamp > Constants.PEER_DEAD_TIME) {
                this.disconnect('Peer is dead!');
            }
        }

        async _pingTick() {
            if (!this.disconnected) {
                const msgPing = new MsgCommon();
                msgPing.pingMessage = true;
                await this.pushMessage(msgPing);
            }
        }
    };
};
