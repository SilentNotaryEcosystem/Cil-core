/**
 * We'll put serialized message to WitnessMessage.content
 *
 * @param {Object} Constants
 * @param {CryptoLib} Crypto
 * @param {WitnessMessageCommon} WitnessMessageCommon
 * @return {{new(*): WitnessMessageCommon}}
 */
module.exports = (Constants, Crypto, WitnessMessageCommon) => {
    const {MSG_WITNESS_EXPOSE} = Constants.messageTypes;

    return class WitnessExpose extends WitnessMessageCommon {

        /**
         *
         * @param {WitnessMessageCommon} msg
         */
        constructor(msg) {
            super(msg);

            if (msg instanceof WitnessMessageCommon) {
                if (msg.isBlock() || msg.isExpose()) {
                    throw new Error(`Message "${msg.message}" could not be exposed!`);
                }
                this.content = msg.encode();
                this.message = MSG_WITNESS_EXPOSE;
            } else {
                throw new Error('This type of message could be constructed only from other witness message!');
            }
        }

        static extract(msgExpose) {
            return new WitnessMessageCommon(msgExpose.content);
        }
    };
};
