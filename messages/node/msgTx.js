/**
 *
 * @param {Object} Constants
 * @param {Crypto} Crypto
 * @param {Object} MessageCommon
 * @param {Transaction} Transaction
 * @return {{new(*): MessageTx}}
 */
module.exports = (Constants, Crypto, MessageCommon, Transaction) => {
    const {MSG_TX} = Constants.messageTypes;

    return class MessageTx extends MessageCommon {
        /**
         *
         * @param {Block | Buffer} data
         */
        constructor(data) {
            if (data instanceof MessageCommon || Buffer.isBuffer(data)) {
                super(data);
                if (!this.isTx()) {
                    throw new Error(`Wrong message type. Expected "${MSG_TX}" got "${this.message}"`);
                }
            } else {
                super();
                if (data instanceof Transaction) this.tx = data;
                this.message = MSG_TX;
            }
        }

        get tx() {
            let block;
            try {
                if (!this.payload) throw TypeError(`Message payload is empty!`);
                block = new Transaction(this.payload);
            } catch (e) {
                logger.error(`Bad TX payload: ${e}`);
            }
            return block;
        }

        /**
         *
         * @param {Transaction} cTransaction
         */
        set tx(cTransaction) {
            if (!(cTransaction instanceof Transaction)) {
                throw TypeError(`Bad block. Expected instance of TX, got ${cTransaction}`);
            }
            this.payload = cTransaction.encode();
        }
    };
};
