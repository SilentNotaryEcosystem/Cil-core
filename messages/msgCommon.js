/**
 *
 * @param {CryptoLib} Crypto
 * @param {Number} NetworkMagic - Network magic number (mainnet or testnet)
 * @param {Object} MessageProto - protobuf compiled Message prototype
 * @return {{new(*): MessageCommon}}
 */
module.exports = (Crypto, NetworkMagic, MessageProto) =>
    class MessageCommon {

        constructor(data) {
            if (data instanceof MessageCommon) {
                this._msg = data._msg;
            } else if (Buffer.isBuffer(data)) {
                this._msg = {...MessageProto.decodeDelimited(data)};
                this._validate();
            } else {
                this._msg = {
                    network: NetworkMagic
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
         * ATTENTION! encodeDelimited will prefix buffer with length!
         *
         * @return {Uint8Array}
         */
        encode() {
            return MessageProto.encodeDelimited(this._msg).finish();
        }

        _validate() {
            if (this._msg.network !== NetworkMagic) {
                throw new Error(`Wrong network! Expected: ${NetworkMagic} got ${this._msg.network}`);
            }

            // TODO add checksum verification
        }

        sign(privateKey) {
            this.encode();
            this.signature = Crypto.sign(this._msg.payload, privateKey);
        }

        verifySignature(publicKey) {
            return Crypto.verify(this._msg.payload, this._msg.signature, publicKey);
        }

        /**
         * verack just message w/o payload
         */
        set verAckMessage(unused) {
            this.message = 'verack';
        }

        /**
         * getaddr just message w/o payload
         */
        set getAddrMessage(unused) {
            this.message = 'getaddr';
        }

        isVerAck() {
            return this.message === 'verack';
        }

        isVersion() {
            return this.message === 'version';
        }

        isGetAddr() {
            return this.message === 'getaddr';
        }

        isAddr() {
            return this.message === 'addr';
        }
    };
