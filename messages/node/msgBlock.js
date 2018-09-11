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
            } else {
                super();
                if (data instanceof Block) this.block = data;
                this.message = MSG_BLOCK;
            }
        }

        get block() {
            let block;
            try {
                if (!this.payload) throw TypeError(`Message payload is empty!`);
                block = new Block(this.payload);
            } catch (e) {
                logger.error(`Bad block payload: ${e}`);
            }
            return block;
        }

        /**
         *
         * @param {Block} cBlock
         */
        set block(cBlock) {
            if (!(cBlock instanceof Block)) {
                throw TypeError(`Bad block. Expected instance of Block, got ${cBlock}`);
            }
            this.payload = cBlock.encode();
        }
    };
};
