/**
 *
 * @param {Object} Constants
 * @param {Object} MessageProto - protobuf compiled message PeerInfo
 * @return {{new(*): MessageCommon}}
 */
module.exports = (Constants, MessageProto) =>
    class PeerInfo {

        constructor(data) {
            if (Buffer.isBuffer(data)) {
                this._data = {...MessageProto.decode(data)};
            } else if (typeof data === 'object') {

                // transform address to internal representation
                if (Buffer.isBuffer(data.address)) {
                    data.address = this._addressDataFromBuffer(data.address);
                }
                if (!data.port) data.port = Constants.port;
                const errMsg = MessageProto.verify(data);
                if (errMsg) throw new Error(errMsg);

                this._data = MessageProto.create(data);
            } else {
                throw new Error('Use buffer or object to initialize PeerInfo');
            }
        }

        get data() {
            return this._data;
        }

        /**
         *
         * @return {Buffer}
         */
        get address() {

            // TODO add cache for address?
            if (!this._data || !this._data.address) throw new Error('PeerInfo not initialized!');
            return this.constructor.addressToBuffer(this._data.address);
        }

        /**
         *
         * @param {Buffer} buff
         */
        set address(buff) {
            if (!this._data) throw new Error('PeerInfo not initialized!');
            this._data.address = this.constructor.addressFromBuffer(buff);
        }

        get port() {
            if (!this._data || !this._data.port) throw new Error('PeerInfo not initialized!');
            return this._data.port;
        }

        get capabilities() {
            return this._data.capabilities;
        }

        /**
         *
         * @param {Object} objAddress - {addr0, addr1, addr2, addr3}
         * @return {Buffer}
         */
        static addressToBuffer(objAddress) {
            const buffer = Buffer.alloc(16);
            buffer.writeUInt32BE(objAddress.addr0, 0);
            buffer.writeUInt32BE(objAddress.addr1, 4);
            buffer.writeUInt32BE(objAddress.addr2, 8);
            buffer.writeUInt32BE(objAddress.addr3, 12);
            return buffer;
        }

        /**
         *
         * @param {Buffer} buff
         * @return {Object} {addr0, addr1, addr2, addr3}
         */
        static addressFromBuffer(buff) {
            const objAddress = {};
            objAddress.addr0 = buff.readInt32BE(0);
            objAddress.addr1 = buff.readInt32BE(4);
            objAddress.addr2 = buff.readInt32BE(8);
            objAddress.addr3 = buff.readInt32BE(12);
            return objAddress;
        }

        /**
         * ATTENTION! JUST encode
         *
         * @return {Uint8Array}
         */
        encode() {
            return MessageProto.encode(this._data).finish();
        }
    };
