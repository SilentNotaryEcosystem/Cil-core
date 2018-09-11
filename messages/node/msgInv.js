/**
 *
 * @param {Object} Constants
 * @param {Crypto} Crypto
 * @param {MessageCommon} MessageCommon
 * @param {Inventory} Inventory
 * @return {{new(*): MessageInv}}
 */
module.exports = (Constants, Crypto, MessageCommon, Inventory) => {
    const {MSG_INV, MSG_GET_DATA} = Constants.messageTypes;

    return class MessageInv extends MessageCommon {

        /**
         *
         * @param {Inventory | Buffer} data
         */
        constructor(data) {
            super(data);

            if ((data instanceof MessageCommon || Buffer.isBuffer(data)) &&
                !(this.isInv() || this.isGetData())) {
                throw new Error(`Wrong message type. Expected "${MSG_INV} | ${MSG_GET_DATA}" got "${this.message}"`);
            }
            this.message = MSG_INV;
        }

        get inventory() {
            let inventory;
            try {
                if (!this.payload) throw TypeError(`Message payload is empty!`);
                inventory = new Inventory(this.payload);
            } catch (e) {
                const msg = `Bad Inventory payload: ${e}`;
                logger.error(msg);
                throw new Error(msg);
            }
            return inventory;
        }

        set inventory(cInventory) {
            if (!(cInventory instanceof Inventory)) {
                throw TypeError(`Bad block. Expected instance of Block, got ${cInventory}`);
            }
            this.payload = cInventory.encode();
        }
    };
};
