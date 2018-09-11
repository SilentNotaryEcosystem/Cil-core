const typeforce = require('typeforce');
const types = require('../types');

module.exports = ({Constants, Crypto}, {inventoryProto}) =>
    class Inventory {
        constructor(data) {
            typeforce(typeforce.oneOf('Number', 'Buffer', types.Empty), data);

            if (data === undefined) data = {};

            if (Buffer.isBuffer(data)) {
                this._data = {...inventoryProto.decode(data)};
            } else if (typeof data === 'object') {
                const errMsg = inventoryProto.verify(data);
                if (errMsg) throw new Error(`Inventory: ${errMsg}`);

                this._data = inventoryProto.create(data);
            }
        }

        encode() {
            return inventoryProto.encode(this._data).finish();
        }

        /**
         *
         * @param {Transaction} tx
         */
        addTx(tx) {
            this._data.invVector.push({type: Constants.INV_TX, hash: tx.hash()});
        }

        /**
         *
         * @param {Block} block
         */
        addBlock(block) {
            this._data.invVector.push({type: Constants.INV_BLOCK, hash: block.hash()});
        }

        get vector() {
            return this._data.invVector;
        }
    };
