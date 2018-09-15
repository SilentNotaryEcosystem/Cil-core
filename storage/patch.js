'use strict';

const typeforce = require('typeforce');
const debugLib = require('debug');
const types = require('../types');

const debug = debugLib('patch:');

// Could be used for undo blocks

module.exports = ({UTXO, Coins}) =>
    class PatchDB {
        constructor() {
            this._data = {
                coinsToAdd: new Map(),
                coinsToRemove: []
            };
        }

        spendCoins(input) {

        }

        /**
         *
         * @param {String} txHash
         * @param {Number} idx
         * @param {Coins} coins
         */
        createCoins(txHash, idx, coins) {
            const utxo = this._data.coinsToAdd.get(txHash) || new UTXO({txHash});
            utxo.addCoins(idx, coins);

            this._data.coinsToAdd.set(txHash, utxo);
        }

        getCoinsToAdd() {
            return this._data.coinsToAdd;
        }
    };
