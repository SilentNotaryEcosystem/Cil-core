/**
 *
 * @param {Object} Constants
 * @param {Crypto} Crypto
 * @param {Object} MessageCommon
 * @param {Block} Block
 * @return {{new(*): MessageBlock}}
 */
module.exports = (Constants, Crypto, MessageCommon, Block) => {
    const {MSG_BLOCK} = Constants.messageTypes;

    return class MessageBlock extends MessageCommon {

        /**
         *
         * @param {Block | Buffer} data
         */
        constructor(data) {

            if (data instanceof MessageCommon || Buffer.isBuffer(data)) {
                super(data);
                if (!this.isBlock()) {
                    throw new Error(`Wrong message type. Expected "${MSG_BLOCK}" got "${this.message}"`);
                }

                this._block = new Block(this.payload);
            } else {
                super();
                if (typeof data === 'object') {
                    this._block = new Block(this.payload);
                }
                this.message = MSG_BLOCK;
            }
        }

        get hash() {
            return this._block.hash;
        }

        /**
         * ATTENTION! for payload we'll use encode NOT encodeDelimited as for entire Message
         *
         * @return {Uint8Array}
         */
        encode() {
            this.payload = this._block.encode();
            return super.encode();
        }
    };
};
