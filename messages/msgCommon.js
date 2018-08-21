/**
 *
 * @param {CryptoLib} Crypto
 * @param {Object} Constants
 * @param {Object} MessageProto - protobuf compiled Message prototype
 * @return {{new(*): MessageCommon}}
 */
module.exports = (Constants, Crypto, MessageProto) => {
    const {MSG_VERSION, MSG_VERACK, MSG_GET_ADDR, MSG_ADDR, MSG_REJECT} = Constants.messageTypes;
    return class MessageCommon {

        constructor(data) {
            if (data instanceof MessageCommon) {
                this._msg = data._msg;
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
         * ATTENTION! encodeDelimited will prefix buffer with length!
         *
         * @return {Uint8Array}
         */
        encode() {
            return MessageProto.encodeDelimited(this._msg).finish();
        }

        _validate() {
            if (!this._msg.network || this._msg.network !== Constants.network) {
                throw new Error(`Wrong network! Expected: ${NetworkMagic} got ${this._msg.network}`);
            }

            // TODO add checksum verification
        }

        sign(privateKey) {
            this.encode();

            // payload will be empty for MSG_VERSION && MSG_VERACK ... so, we couldn't hash undefined
            // but we could sign it
            const payloadHash = this.payload ? Buffer.from(Crypto.createHash(this.payload), 'hex') : undefined;
            this.signature = Crypto.sign(payloadHash, privateKey);
        }

        verifySignature(publicKey) {

            // payload will be empty for MSG_VERSION && MSG_VERACK ... so, we couldn't hash undefined
            // but we could sign it
            const payloadHash = this.payload ? Buffer.from(Crypto.createHash(this.payload), 'hex') : undefined;
            return Crypto.verify(payloadHash, this.signature, publicKey);
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
    };
};
