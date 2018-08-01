/**
 *
 * @param {Number} NetworkMagic - Network magic number (mainnet or testnet)
 * @param {Object} MessageProto - protobuf compiled Message prototype
 * @return {{new(*): MessageCommon}}
 */
module.exports = (NetworkMagic, MessageProto) =>
    class MessageCommon {

        constructor(buffer) {
            if (buffer) {
                this._msg = {...MessageProto.decodeDelimited(buffer)};
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
