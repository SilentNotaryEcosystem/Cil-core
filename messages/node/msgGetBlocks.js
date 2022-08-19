/**
 *
 * @param {Object} Constants
 * @param {ArrayOfHashes} ArrayOfHashes
 * @param {Object} MessageCommon
 * @param {Object} GetBlocksPayloadProto - protobuf compiled AddrPayload prototype
 * @return {{new(*): MessageAddr}}
 */
module.exports = (Constants, ArrayOfHashes, MessageCommon, GetBlocksPayloadProto) => {
    const {MSG_GET_BLOCKS} = Constants.messageTypes;

    return class MessageGetBlocks extends MessageCommon {
        /**
         *
         * @param {Object|Buffer} data
         */
        constructor(data) {
            if (data instanceof MessageCommon || Buffer.isBuffer(data)) {
                super(data);
                if (!this.isGetBlocks()) {
                    throw new Error(`Wrong message type. Expected "${MSG_GET_BLOCKS}" got "${this.message}"`);
                }

                this._data = {...GetBlocksPayloadProto.decode(this.payload)};
            } else {
                super();
                this._data = {};

                if (typeof data === 'object') {
                    const errMsg = GetBlocksPayloadProto.verify(data);
                    if (errMsg) throw new Error(`MessageGetBlocks: ${errMsg}`);

                    this._data = GetBlocksPayloadProto.create(data);
                }
                this.message = MSG_GET_BLOCKS;
            }
        }

        /**
         *
         * @returns {string[]}
         */
        get arrHashes() {
            return new ArrayOfHashes(this._data.arrHashes).getArray();
        }

        set arrHashes(arrHashes) {
            this._data.arrHashes = new ArrayOfHashes(arrHashes).encode();
        }

        /**
         * ATTENTION! for payload we'll use encode NOT encodeDelimited as for entire Message
         *
         * @return {Uint8Array}
         */
        encode() {
            this.payload = GetBlocksPayloadProto.encode(this._data).finish();
            return super.encode();
        }
    };
};
