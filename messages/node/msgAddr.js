/**
 *
 * @param {Object} Constants
 * @param {Object} MessageCommon
 * @param {Object} AddrPayloadProto - protobuf compiled AddrPayload prototype
 * @return {{new(*): MessageAddr}}
 */
module.exports = (Constants, MessageCommon, AddrPayloadProto) => {
    const {MSG_ADDR} = Constants.messageTypes;

    return class MessageAddr extends MessageCommon {

        /**
         *
         * @param {Object|Buffer} data
         * @param {Number} data.peers - array of peerInfo
         */
        constructor(data) {

            if (data instanceof MessageCommon || Buffer.isBuffer(data)) {
                super(data);
                if (!this.isAddr()) {
                    throw new Error(`Wrong message type. Expected "${MSG_ADDR}" got "${this.message}"`);
                }

                this._data = {...AddrPayloadProto.decode(this.payload)};
                // TODO: free this.message.payload after decode to reduce memory usage
            } else {
                super();
                if (typeof data === 'object') {
                    const errMsg = AddrPayloadProto.verify(data);
                    if (errMsg) throw new Error(`MessageAddr: ${errMsg}`);

                    this._data = AddrPayloadProto.create(data);
                }
                this.message = MSG_ADDR;
            }
        }

        /**
         *
         * @return {Array} of PeerInfo
         */
        get peers() {
            return this._data.peers;
        }

        /**
         * ATTENTION! for payload we'll use encode NOT encodeDelimited as for entire Message
         *
         * @return {Uint8Array}
         */
        encode() {
            this.payload = AddrPayloadProto.encode(this._data).finish();
            return super.encode();
        }
    };
};
