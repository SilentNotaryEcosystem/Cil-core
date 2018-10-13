const typeforce = require('typeforce');
const types = require('../types');

module.exports = ({Coins}, {utxoProto}) =>
    class UTXO {
        /**
         *
         * @param {String} txHash - mandatory! when it restored from storage, you should set it from key!
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

                if (data && Buffer.isBuffer(data)) {
                    this._data = utxoProto.decode(data);
                }
            } else {
                throw new Error('Construct from txHash');
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

        /**
         *
         * @returns {string | *}
         */
        getTxHash() {
            return this._strHash;
        }

        /**
         *
         * @param {Number} idx - outputNo
         * @param {Coins} coins -
         */
        addCoins(idx, coins) {
            typeforce(typeforce.tuple(types.Amount, types.Coins), arguments);

            if (~this._data.arrIndexes.findIndex(i => i === idx)) {
                throw new Error(`Tx ${this._strHash} index ${idx} already added!`);
            }

            // this will make serialization mode simple
            this._data.arrOutputs.push(coins.getRawData());
            this._data.arrIndexes.push(idx);
        }

        spendCoins(nTxOutput) {
            typeforce('Number', nTxOutput);

            const idx = this._data.arrIndexes.findIndex(i => i === nTxOutput);
            if (!~idx) {
                throw new Error(`Tx ${this._strHash} index ${nTxOutput} already deleted!`);
            }

            this._data.arrIndexes.splice(idx, 1);
            this._data.arrOutputs.splice(idx, 1);
        }

        /**
         *
         * @param {Number} idx - outputNo
         * @returns {Coins}
         */
        coinsAtIndex(idx) {
            typeforce('Number', idx);

            const index = this._data.arrIndexes.findIndex(nOutput => nOutput === idx);
            if (!~index) throw new Error(`Output #${idx} of Tx ${this._strHash} already spent!`);

            return Coins.createFromData(this._data.arrOutputs[index]);
        }

        encode() {
            return utxoProto.encode(this._data).finish();
        }

        getIndexes() {
            return this._data.arrIndexes;
        }

        /**
         *
         * @returns {UTXO} - cloned instance
         */
        clone() {
            return new UTXO({txHash: this.getTxHash(), data: this.encode()});
        }
    };
