const EventEmitter = require('events');
const assert = require('assert');
const debug = require('debug')('peer:');
const {sleep, createPeerTag} = require('../utils');
const Tick = require('tick-tock');

const PEER_HEARTBEAT_TIMER_NAME = 'peerHeartbeatTimer';

/**
 * Хранит информацию о Peer'е
 * - для хранения состояния peer'а при обработке сообщений
 *
 * @emits 'message' {this, message}
 */

module.exports = (factory) => {
    const {Messages, Transport, Constants, FactoryOptions} = factory;
    const {
        MsgCommon,
        PeerInfo
    } = Messages;
    //const {PeerInfo} = Messages;
    return class Peer extends EventEmitter {
        constructor(options = {}) {
            super();
            const {connection, peerInfo, transport} = options;

            this._persistent = false;
            this._nonce = parseInt(Math.random() * 100000);
            this._transport = transport ? transport : new Transport(options);

            this._bannedTill = Date.now();
            this._restrictedTill = Date.now();
            this._misbehavedAt = Date.now();
            this._misbehaveScore = 0;

            this._cleanup();

            this._heartBeatTimer = new Tick(this);
            this._timerName = PEER_HEARTBEAT_TIMER_NAME + this._nonce;

            this._randomMsecDelta = parseInt(Math.random() * 100000);

            // this means that we have incoming connection
            if (connection) {
                this._connection = connection;
                this._bInbound = true;
                this._setConnectionHandlers();
                this._peerInfo = new PeerInfo({
                    address: Transport.strToAddress(connection.remoteAddress),
                    port: connection.remotePort
                });
                this._connectedTill = new Date(Date.now() + Constants.PEER_CONNECTION_LIFETIME + this._randomMsecDelta);

                // run heartbeat timer
                this._heartBeatTimer.setInterval(this._timerName, this._tick, Constants.PEER_HEARTBEAT_TIMEOUT);
            } else if (peerInfo) {
                this.peerInfo = peerInfo;
            } else {
                throw new Error('Pass connection or peerInfo to create peer');
            }

            this._whitelisted = false;
        }

        get amountBytes() {
            return this._transmittedBytes + this._receivedBytes;
        }

        get misbehaveScore() {
            return this._misbehaveScore;
        }

        get transmittedBytes() {
            return this._transmittedBytes;
        }

        get receivedBytes() {
            return this._receivedBytes;
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
            this.addTag('fullyConnected');
            this._handshakeDone = true;
        }

        get loadDone() {
            return this._loadDone || this.disconnected;
        }

        set loadDone(trueVal) {
            this._loadDone = true;
        }

        /**
         * @see witness.js/constructor
         * @return {String}
         */
        get witnessAddress() {
            if (!this.isWitness) throw new Error('This peer has no witness capability');
            const witnessCap = this._peerInfo.capabilities.find(cap => cap.service === Constants.WITNESS);
            return witnessCap.data.toString('hex');
        }

        get offsetDelta() {
            return this._msecOffsetDelta;
        }

        set offsetDelta(delta) {
            this._msecOffsetDelta = delta;
        }

        get quality() {
            return (this._peerInfo.lifetimeReceivedBytes + this._peerInfo.lifetimeTransmittedBytes + this.amountBytes)
                   / (this._peerInfo.lifetimeMisbehaveScore + this.misbehaveScore + 1);
        }

        get bannedTill() {
            return this._bannedTill;
        }

        witnessLoadDone(nConciliumId) {
            return !this.disconnected && this._persistent && this._tags.has(createPeerTag(nConciliumId));
        }

        /**
         * Update capabilities & canonical port from MSG_VERSION
         *
         * @param peerInfo
         */
        updatePeerFromPeerInfo(peerInfo, bUpdateAddress = false) {
            this._peerInfo.capabilities = peerInfo.capabilities;
            this._peerInfo.port = peerInfo.port;

            if (bUpdateAddress) {
                const cPeerInfo = peerInfo instanceof PeerInfo ? peerInfo : new PeerInfo(peerInfo);
                this._peerInfo.address = cPeerInfo.address;
            }
        }

        markAsWhitelisted() {
            this._whitelisted = true;
        }

        isWhitelisted() {
            return this._whitelisted;
        }

        /**
         * this means peer was disconnected because we wish to connect to various nodes
         * but if there are no other peer (small net) - we'll reconnect after PEER_RESTRICT_TIME interval
         *
         * @returns {boolean}
         */
        isRestricted() {
            return !this._persistent && this._restrictedTill > Date.now();
        }

        isBanned() {
            return this._bannedTill > Date.now();
        }

        /**
         * witness peers shouldn't be disconnected
         */
        markAsPersistent() {
            this._persistent = true;
        }

        addTag(tag) {
            this._tags.add(tag);
        }

        hasTag(tag) {
            return tag === undefined || this._tags.has(tag);
        }

        isAlive() {
            const tsAlive = Date.now() - Constants.PEER_DEAD_TIME;
            return this.lastActionTimestamp && this.lastActionTimestamp > tsAlive;
        }

        async loaded() {
            for (let i = 0; i < Constants.PEER_QUERY_TIMEOUT / 100; i++) {
                await sleep(100);
                if (this.loadDone) break;
            }
        }

        async witnessLoaded(nConciliumId) {
            for (let i = 0; i < Constants.PEER_QUERY_TIMEOUT / 100; i++) {
                await sleep(100);
                if (this.witnessLoadDone(nConciliumId)) break;
            }
        }

        /**
         *
         * @param {String | undefined} strLocalAddress - address connect from
         * @return {Promise<void>}
         */
        async connect(strLocalAddress) {
            if (this.isBanned()) {
                logger.error('Trying to connect to banned peer!');
                return;
            }
            if (this.isRestricted()) {
                logger.error('Trying to connect to temporary restricted peer!');
                return;
            }
            if (!this.disconnected) {
                logger.error(`Peer ${this.address} already connected`);
                return;
            }
            this._transmittedBytes = 0;
            this._receivedBytes = 0;
            this._connection = await this._transport.connect(this.address, this.port, strLocalAddress);
            this._connectedTill = new Date(Date.now() + Constants.PEER_CONNECTION_LIFETIME);
            this._setConnectionHandlers();

            // run heartbeat timer
            this._heartBeatTimer.setInterval(this._timerName, this._tick, Constants.PEER_HEARTBEAT_TIMEOUT);
        }

        _setConnectionHandlers() {
            if (this._connection.listenerCount('message')) return;

            this._connection.on('message', this._onMessageHandler.bind(this));

            this._connection.on('close', () => {
                debug(`Peer "${this.address}" connection closed by remote`);
                this._cleanup();
                this.emit('disconnect', this);
            });
        }

        async _onMessageHandler(msg) {

            // count incoming bytes
            if (msg.payload && Buffer.isBuffer(msg.payload)) {
                this._updateReceived(msg.payload.length);

                // TODO: remove it? we'll rely on timer. we don't need to be very precise
                if (!this._persistent && this.amountBytes > Constants.PEER_MAX_BYTES_COUNT) {
                    this.disconnect(`Limit "${Constants.PEER_MAX_BYTES_COUNT}" bytes reached for peer`);
                }
            }
            this._lastActionTimestamp = Date.now();

            if (msg.signature) {

                // if message signed: check signature
                if (this.isWitness && msg.address === this.witnessAddress) {
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
        }

        // TODO: for MsgGetData - make a cache for already requested hashes!
        async pushMessage(msg) {

            // part of node bootstrap mechanism
            if (msg.isGetBlocks()) this.getBlocksSent();

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
                        this._updateTransmitted(nextMsg.payload.length);
                    }
                }
                this._queue = undefined;

                // TODO: remove it? we'll rely on timer. we don't need to be very precise
                if (!this._persistent && this.amountBytes > Constants.PEER_MAX_BYTES_COUNT) {
                    this.disconnect(`Limit "${Constants.PEER_MAX_BYTES_COUNT}" bytes reached for peer`);
                }
            }
        }

        ban() {
            if (this.isWhitelisted()) return;

            this._updateMisbehave(Constants.BAN_PEER_SCORE);
            this._bannedTill = Date.now() + Constants.BAN_PEER_TIME;
            logger.log(`Peer ${this.address} banned till ${new Date(this._bannedTill)}`);
            if (!this.disconnected) this.disconnect('Peer banned');
            this.emit('peerBanned', this);
        }

        misbehave(score) {
            debug(`Peer ${this.address} misbehaving. Current score: ${this._misbehaveScore}. Will add: ${score}. `);

            // reset _misbehaveScore if it was Constants.BAN_PEER_TIME ago
            if (Date.now() - this._misbehavedAt > Constants.BAN_PEER_TIME) this._misbehaveScore = 0;

            this._updateMisbehave(score);
            this._misbehavedAt = Date.now();

            if (this._misbehaveScore >= Constants.BAN_PEER_SCORE) this.ban();
        }

        disconnect(reason) {
            this._heartBeatTimer.clear(this._timerName);
            assert(this._connection, 'Trying to disconnect already disconnected peer');

            debug(`${reason}. Closing connection to "${this._connection.remoteAddress}"`);
            try {
                this._connection.close();
            } catch (err) {
                logger.error(err);
            }

            this._cleanup();

            // once we got disconnected - restrict it
            this._restrictedTill = Date.now() + Constants.PEER_RESTRICT_TIME + this._randomMsecDelta;
            this.emit('disconnect', this);
        }

        _cleanup() {
            this._tags = new Set();
            this._connection = undefined;

            this._handshakeDone = false;
            this._version = undefined;

//            this._bannedTill = Date.now();
//            this._restrictedTill = Date.now();
//            this._misbehavedAt = Date.now();
//            this._misbehaveScore = 0;
//            this._lastActionTimestamp = Date.now();

            this._transmittedBytes = 0;
            this._receivedBytes = 0;

            this._msecOffsetDelta = 0;

            this._bInbound = false;
            this._msecOffsetDelta = 0;

            this._loadDone = false;

            this._nCountSingleBlocks = 0;
        }

        async _tick() {

            // stop timer if peer disconnected. disconnect == dead. dead == no heartbeat
            if (this.disconnected) {
                this._heartBeatTimer.clear(this._timerName);
                return;
            }

            // disconnect non persistent peers when time has come
            if (!this._persistent && !this.disconnected && this._connectedTill < Date.now()) {
                this.disconnect('Scheduled disconnect');
                this._restrictedTill = Date.now() + Constants.PEER_RESTRICT_TIME;
                return;
            }

            if (this._lastActionTimestamp + Constants.PEER_DEAD_TIME < Date.now()) {
                this.disconnect('Peer is dead!');
                return;
            }

            const msgPing = new MsgCommon();
            msgPing.pingMessage = true;
            await this.pushMessage(msgPing);
        }

        /**
         *
         * @returns {peerInfo} with zero counters
         */
        toObject() {

            // TODO: create separate definition for peerInfo & peerAddressBookEntry
            return {
                ...this.peerInfo.data,
                lifetimeMisbehaveScore: 0,
                lifetimeTransmittedBytes: 0,
                lifetimeReceivedBytes: 0
            };
        }

        _updateReceived(bytes) {
            this._receivedBytes += bytes;
            this.peerInfo.lifetimeReceivedBytes += bytes;
        }

        _updateTransmitted(bytes) {
            this._transmittedBytes += bytes;
            this.peerInfo.lifetimeTransmittedBytes += bytes;
        }

        _updateMisbehave(score) {
            this.peerInfo.lifetimeMisbehaveScore += score;
            this._misbehaveScore += score;
        }

        markAsPossiblyAhead() {
            this._bPossiblyAhead = true;
        }

        markAsEven() {
            this._bPossiblyAhead = false;
        }

        isAhead() {
            return this._bPossiblyAhead;
        }

        getBlocksSent() {
            this._nCountSingleBlocks = 0;
            this._getBlocksValidTill = Date.now() + Constants.INV_REQUEST_HOLDOFF;
        }

        isGetBlocksSent() {
            return this._getBlocksValidTill && this._getBlocksValidTill > Date.now();
        }

        doneGetBlocks() {
            this._getBlocksValidTill = undefined;
        }

        singleBlockRequested() {
            if (!FactoryOptions.slowBoot && ++this._nCountSingleBlocks > 6) this.markAsPossiblyAhead();
        }
    };
};
