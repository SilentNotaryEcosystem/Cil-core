const typeforce = require('typeforce');
const types = require('../types');

const {arrayEquals} = require('../utils');

module.exports = ({Coins}, {utxoProto}) =>
    class UTXO {
        /**
         *
         * @param {String} txHash - mandatory! when it restored from storage, you should set it from key!
         * @param {Buffer} data - if we deserialize from storage
         */
        constructor({txHash, data}) {
            if (txHash) {
                typeforce(types.Str64, txHash);

                this._txHash = txHash;
                this._data = {
                    arrIndexes: [],
                    arrOutputs: []
                };

                if (data && Buffer.isBuffer(data)) {
                    this._data = utxoProto.decode(data);

                    // fix fixed64 conversion to Long. see https://github.com/dcodeIO/ProtoBuf.js/
                    // If a proper way to work with 64 bit values (uint64, int64 etc.) is required,
                    // just install long.js alongside this library.
                    // All 64 bit numbers will then be returned as a Long instance instead of a possibly
                    // unsafe JavaScript number (see).
                    for (let output of this._data.arrOutputs) {
                        output.amount = output.amount.toNumber();
                    }
                }
            } else {
                throw new Error('Construct from txHash');
            }
        }

        /**
         *
         * @param {Object} data - {_txHash, _data} raw data of class UTXO
         * @returns {UTXO}
         */
        static createFromData(data) {
            data.__proto__ = this.prototype;
            return data;
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
            return Buffer.isBuffer(this._txHash) ? this._txHash.toString('hex') : this._txHash;
        }

        /**
         *
         * @param {Number} idx - outputNo
         * @param {Coins} coins -
         * @returns {UTXO} this - to chain calls
         */
        addCoins(idx, coins) {
            typeforce(typeforce.tuple(types.Amount, types.Coins), arguments);

            if (~this._data.arrIndexes.findIndex(i => i === idx)) {
                throw new Error(`Tx ${this.getTxHash()} index ${idx} already added!`);
            }

            // this will make serialization mode simple
            this._data.arrOutputs.push(coins.getRawData());
            this._data.arrIndexes.push(idx);

            return this;
        }

        spendCoins(nTxOutput) {
            typeforce('Number', nTxOutput);

            const idx = this._data.arrIndexes.findIndex(i => i === nTxOutput);
            if (!~idx) {
                throw new Error(`Tx ${this.getTxHash()} index ${nTxOutput} already deleted!`);
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
            if (!~index) throw new Error(`Output #${idx} of Tx ${this.getTxHash()} already spent!`);

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

        /**
         *
         * @param {UTXO} utxo
         * @returns {*|boolean}
         */
        equals(utxo) {
            return arrayEquals(this.getIndexes(), utxo.getIndexes()) &&
                   this.getIndexes().every(idx => this.coinsAtIndex(idx).equals(utxo.coinsAtIndex(idx)));
        }

        /**
         * Amount of coins to transfer with this UTXO
         *
         * @returns {Number}
         */
        amountOut() {
            return this._data.arrIndexes.reduce((accum, idx) => {
                const coins = this.coinsAtIndex(idx);
                return accum + coins.getAmount();
            }, 0);
        }

        /**
         * @returns {Object} {idx: {amount, receiverAddr}}
         */
        toObject() {
            const objResult = {};
            this._data.arrIndexes.forEach((idx, i) => {
                const coins = this._data.arrOutputs[i];
                objResult[idx] = {
                    amount: coins.amount,
                    receiverAddr: coins.receiverAddr.toString('hex')
                };
            });
            return objResult;
        }

        /**
         *
         * @param {Buffer | String} address
         * @return {Array} of vectors [idx, COINS] of address
         */
        getOutputsForAddress(address) {
            typeforce(types.Address, address);

            address = Buffer.from(address, 'hex');

            return this._data.arrIndexes
                .filter((idx) => {
                    const coin = this.coinsAtIndex(idx);
                    return coin.getReceiverAddr().equals(address);
                })
                .map(idx => [idx, this.coinsAtIndex(idx)]);
        }

        /**
         *
         * @returns {Array} of strAddresses
         */
        getReceivers() {
            const set = new Set();
            for (let objCoins of this._data.arrOutputs) {
                const coins = Coins.createFromData(objCoins);
                set.add(coins.getReceiverAddr().toString('hex'));
            }
            return [...set];
        }

        /**
         * Return new instance that contain only outputs for address
         *
         * @param {String | Buffer} address
         */
        filterOutputsForAddress(address) {
            const utxoFiltered = new this.constructor({txHash: this.getTxHash()});
            const arrAddrOutputs = this.getOutputsForAddress(address);
            if (arrAddrOutputs.length) {
                arrAddrOutputs.forEach(([idx, coins]) => {
                    utxoFiltered.addCoins(idx, coins);
                });
            }
            return utxoFiltered;
        }
    };
