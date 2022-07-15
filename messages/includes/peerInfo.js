/**
 *
 * @param {Object} Constants
 * @param {Object} PeerInfoProto - protobuf compiled message PeerInfo
 * @return {{new(*): MessageCommon}}
 */
module.exports = (Constants, PeerInfoProto) =>
    class PeerInfo {

        constructor(data) {
            if (Buffer.isBuffer(data)) {
                this._data = {...PeerInfoProto.decode(data)};
            } else if (typeof data === 'object') {

                // transform address to internal representation
                if (Buffer.isBuffer(data.address)) {
                    data.address = this.constructor.fromAddress(data.address);
                }
                if (!data.port) data.port = Constants.port;
                if (!data.capabilities) data.capabilities = [{service: Constants.NODE}];

                const errMsg = PeerInfoProto.verify(data);
                if (errMsg) throw new Error(`PeerInfo: ${errMsg}`);

                this._data = PeerInfoProto.create(data);
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
            return this.constructor.toAddress(this._data.address);
        }

        /**
         *
         * @param {Buffer} buff
         */
        set address(buff) {
            if (!this._data) throw new Error('PeerInfo not initialized!');
            this._data.address = this.constructor.fromAddress(buff);
        }

        get port() {
            if (!this._data || !this._data.port) throw new Error('PeerInfo not initialized!');
            return this._data.port;
        }

        set port(value) {
            if (!this._data) throw new Error('PeerInfo not initialized!');
            this._data.port = value;
        }

        addCapability(objCapability) {
            return this._data.capabilities.push(objCapability);
        }

        get capabilities() {
            return this._data.capabilities;
        }

        set capabilities(objValue) {
            this._data.capabilities = objValue;
        }

        get lifetimeMisbehaveScore() {
            return this._data.lifetimeMisbehaveScore;
        }

        set lifetimeMisbehaveScore(score) {
            this._data.lifetimeMisbehaveScore = score;
        }

        get lifetimeTransmittedBytes() {
            return this._data.lifetimeTransmittedBytes;
        }

        set lifetimeTransmittedBytes(bytesCount) {
            this._data.lifetimeTransmittedBytes = bytesCount;
        }

        get lifetimeReceivedBytes() {
            return this._data.lifetimeReceivedBytes;
        }

        set lifetimeReceivedBytes(bytesCount) {
            this._data.lifetimeReceivedBytes = bytesCount;
        }

        get failedConnectionCount() {
            return this._data.failedConnectionCount;
        }

        set failedConnectionCount(count) {
            this._data.failedConnectionCount = count;
        }

        /**
         *
         * @param {Object} objAddress - {addr0, addr1, addr2, addr3}
         * @return {Buffer}
         */
        static toAddress(objAddress) {
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
        static fromAddress(buff) {
            const objAddress = {};
            objAddress.addr0 = buff.readUInt32BE(0);
            objAddress.addr1 = buff.readUInt32BE(4);
            objAddress.addr2 = buff.readUInt32BE(8);
            objAddress.addr3 = buff.readUInt32BE(12);
            return objAddress;
        }

        /**
         * ATTENTION! JUST encode
         *
         * @return {Uint8Array}
         */
        encode() {
            return PeerInfoProto.encode(this._data).finish();
        }
    };
