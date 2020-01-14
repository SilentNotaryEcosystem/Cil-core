/**
 *
 * @param {CryptoLib} Crypto
 * @param {Object} Constants
 * @param {Object} MessageProto - protobuf compiled Message prototype
 * @return {{new(*): MessageCommon}}
 */
module.exports = (Constants, Crypto, MessageProto) => {
    const {
        MSG_VERSION,
        MSG_VERACK,
        MSG_GET_ADDR,
        MSG_ADDR,
        MSG_REJECT,
        MSG_BLOCK,
        MSG_TX,
        MSG_INV,
        MSG_GET_DATA,
        MSG_GET_BLOCKS,
        MSG_GET_MEMPOOL,
        MSG_PING,
        MSG_PONG
    } = Constants.messageTypes;

    return class MessageCommon {

        constructor(data) {
            if (data instanceof MessageCommon) {
                this._msg = Object.assign({}, data._msg);
            } else if (Buffer.isBuffer(data)) {
                this._msg = {...MessageProto.decodeDelimited(data)};
                this._validate();
            } else {
                this._msg = {
                    network: Constants.network
                };
            }
        }

        get payload() {
            return this._msg.payload;
        }

        set payload(buffValue) {
            if (!Buffer.isBuffer(buffValue)) throw new Error(`Expected Buffer got ${typeof buffValue}`);
            this._msg.payload = buffValue;
        }

        get signature() {
            return this._msg.signature;
        }

        set signature(buffValue) {
            if (!Buffer.isBuffer(buffValue)) throw new Error(`Expected Buffer got ${typeof buffValue}`);
            this._msg.signature = buffValue;
        }

        /**
         *
         * @return {Number} NetworkMagic
         */
        get network() {
            return this._msg.network;
        }

        /**
         *
         * @return {String} message name
         */
        get message() {
            return this._msg.message;
        }

        /**
         *
         * @param {String} strValue
         */
        set message(strValue) {
            this._msg.message = strValue;
        }

        /**
         * MSG_VERACK just message w/o payload
         */
        set verAckMessage(unused) {
            this.message = MSG_VERACK;
        }

        /**
         * MSG_GET_ADDR just message w/o payload
         */
        set getAddrMessage(unused) {
            this.message = MSG_GET_ADDR;
        }

        /**
         * MSG_PING just message w/o payload
         */
        set pingMessage(unused) {
            this.message = MSG_PING;
        }

        /**
         * MSG_PONG just message w/o payload
         */
        set pongMessage(unused) {
            this.message = MSG_PONG;
        }

        /**
         * MSG_GET_MEMPOOL just message w/o payload
         */
        set getMempoolMessage(unused) {
            this.message = MSG_GET_MEMPOOL;
        }

        /**
         * ATTENTION! encodeDelimited will prefix buffer with length!
         *
         * @return {Uint8Array}
         */
        encode() {
            return MessageProto.encodeDelimited(this._msg).finish();
        }

        _validate() {
            if (!this.network || this.network !== Constants.network) {
                throw new Error(`Wrong network! Expected: ${Constants.network} got ${this._msg.network}`);
            }

            // TODO add checksum verification
        }

        get payloadHash() {

            // payload will be empty for MSG_VERSION && MSG_VERACK ... so, we couldn't hash undefined
            // but we could sign it
            return this.payload ? Buffer.from(Crypto.createHash(this.payload), 'hex') : undefined;
        }

        sign(privateKey) {
            this.encode();
            this.signature = Crypto.sign(this.payloadHash, privateKey);
        }

        verifySignature(publicKey) {
            return Crypto.verify(this.payloadHash, this.signature, publicKey);
        }

        get _publicKey() {
            if (!this.signature) throw new Error('Message has no signature');
            return Crypto.recoverPubKey(this.payloadHash, this.signature);
        }

        get address() {
            return Crypto.getAddress(this._publicKey);
        }

        isVerAck() {
            return this.message === MSG_VERACK;
        }

        isVersion() {
            return this.message === MSG_VERSION;
        }

        isGetAddr() {
            return this.message === MSG_GET_ADDR;
        }

        isAddr() {
            return this.message === MSG_ADDR;
        }

        isReject() {
            return this.message === MSG_REJECT;
        }

        isBlock() {
            return this.message === MSG_BLOCK;
        }

        isTx() {
            return this.message === MSG_TX;
        }

        isInv() {
            return this.message === MSG_INV;
        }

        isGetData() {
            return this.message === MSG_GET_DATA;
        }

        isGetBlocks() {
            return this.message === MSG_GET_BLOCKS;
        }

        isGetMempool() {
            return this.message === MSG_GET_MEMPOOL;
        }

        isPing() {
            return this.message === MSG_PING;
        }

        isPong() {
            return this.message === MSG_PONG;
        }

    };
};
