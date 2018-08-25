/**
 *
 * @param {Object} Constants
 * @param {WitnessMessageCommon} WitnessMessageCommon
 * @param {Block} Block
 * @return {{new(*): WitnessMessageBlock}}
 */
module.exports = (Constants, WitnessMessageCommon, Block) => {
    const {MSG_WITNESS_BLOCK} = Constants.messageTypes;

    return class WitnessMessageBlock extends WitnessMessageCommon {
        constructor(data) {
            super(data);
            if (data instanceof WitnessMessageCommon || Buffer.isBuffer(data)) {
                if (!this.isWitnessBlock()) {
                    throw new Error(`Wrong message type. Expected "${MSG_WITNESS_BLOCK}" got "${this.message}"`);
                }
            }
            this.message = MSG_WITNESS_BLOCK;
        }

        get block() {
            let block;
            try {
                if (!this.content) throw TypeError(`Message content is empty!`);
                block = new Block(this.content);
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
            this.content = cBlock.encode();
        }
    };
};
