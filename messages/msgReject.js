/**
 *
 * @param {Object} MessageCommon
 * @param {Object} RejectProto - protobuf compiled AddrPayload prototype
 * @return {{new(*): MessageReject}}
 */
module.exports = (MessageCommon, RejectProto) =>

    class MessageReject extends MessageCommon {

        /**
         *
         * @param {Object|Buffer} data
         * @param {Number} data.peers - array of peerInfo
         */
        constructor(data) {

            if (data instanceof MessageCommon || Buffer.isBuffer(data)) {
                super(data);
                if (this.message !== 'reject') {
                    throw new Error(`Wrong message type. Expected 'reject' got '${this.message}'`);
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
                this.message = 'reject';
            }
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
