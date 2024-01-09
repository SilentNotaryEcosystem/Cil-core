/**
 *
 * @param {Object} Constants
 * @param {Crypto} Crypto
 * @param {MessageInv} MessageInv
 * @param {Inventory} Inventory
 * @return {{new(*): MessageGetData}}
 */
module.exports = (Constants, Crypto, MessageInv) => {
    const {MSG_GET_DATA} = Constants.messageTypes;

    return class MessageGetData extends MessageInv {
        /**
         *
         * @param {Inventory | Buffer} data
         */
        constructor(data) {
            super(data);
            this.message = MSG_GET_DATA;
        }
    };
};
