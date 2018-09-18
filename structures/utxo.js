const typeforce = require('typeforce');
const types = require('../types');

module.exports = () =>
    class UTXO {
        /**
         *
         * @param {String} txHash - if we manually creates object
         * @param {Buffer} data - if we deserialize from storage
         */
        constructor({txHash, data}) {
            if (txHash) {
                typeforce(types.Hash256bit, txHash);

                this._txHash = txHash;
                this._strHash = txHash.toString('hex');
                this._data = {
                    arrIndexes: [],
                    arrOutputs: []
                };
            } else if (data && Buffer.isBuffer(data)) {

                // TODO: decode from serialized data from storage
            } else {
                throw new Error('Construct from txHash or serialized data');
            }
        }

        /**
         * All outputs in UTXO are spent!
         *
         * @returns {boolean}
         */
        isEmpty() {
            if (this._data.arrIndexes.length !== this._data.arrOutputs.length) {
                throw new Error(
                    'UTXO integrity check failed!');
            }
            return !this._data.arrIndexes.length;
        }

        getTxHash() {
            return this._txHash;
        }

        addCoins(idx, coins) {
            typeforce(typeforce.tuple(types.Amount, types.Coins), arguments);

            if (~this._data.arrIndexes.findIndex(i => i === idx)) {
                throw new Error(`Tx ${this._strHash} index ${idx} already added!`);
            }

            this._data.arrIndexes.push(idx);
            this._data.arrOutputs.push(coins);
        }

        spendCoins(nTxOutput) {
            typeforce('Number', nTxOutput);

            const idx = this._data.arrIndexes.findIndex(i => i === nTxOutput);
            if (!~idx) {
                throw new Error(`Tx ${this._strHash} index ${idx} already deleted!`);
            }

            this._data.arrIndexes.splice(idx, 1);
            this._data.arrOutputs.splice(idx, 1);
        }

        coinsAtIndex(idx) {
            typeforce('Number', idx);

            const index = this._data.arrIndexes.findIndex(nOutput => nOutput === idx);
            if (!~index) throw new Error(`Output #${idx} of Tx ${this._strHash} already spent!`);

            return this._data.arrOutputs[index];
        }

    };
