/**
 *
 * @param {Object} Constants
 * @param {Object} MessageCommon
 * @param {Object} RejectProto - protobuf compiled AddrPayload prototype
 * @return {{new(*): MessageReject}}
 */
module.exports = (Constants, MessageCommon, RejectProto) => {
    const {MSG_REJECT} = Constants.messageTypes;

    return class MessageReject extends MessageCommon {

        /**
         *
         * @param {Object|Buffer} data
         * @param {Number} data.peers - array of peerInfo
         */
        constructor(data) {

            if (data instanceof MessageCommon || Buffer.isBuffer(data)) {
                super(data);
                if (!this.isReject()) {
                    throw new Error(`Wrong message type. Expected "${MSG_REJECT}" got "${this.message}"`);
                }

                this._data = {...RejectProto.decode(this.payload)};
                // TODO: free this.message.payload after decode to reduce memory usage
            } else {
                super();
                if (typeof data === 'object') {
                    const errMsg = RejectProto.verify(data);
                    if (errMsg) throw new Error(`RejectProto: ${errMsg}`);

                    this._data = RejectProto.create(data);
                }
                this.message = MSG_REJECT;
            }
        }

        get reason() {
            return this._data.reason;
        }

        /**
         * ATTENTION! for payload we'll use encode NOT encodeDelimited as for entire Message
         *
         * @return {Uint8Array}
         */
        encode() {
            this.payload = RejectProto.encode(this._data).finish();
            return super.encode();
        }
    };
};
