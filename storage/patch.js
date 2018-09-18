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
                coinsToRemove: new Map()
            };
        }

        /**
         * it WILL MODIFY utxo!!
         * because this will allow us to modify UTXO and then just rewrite it in DB.
         * another approach: store only modifications, get UTXO from Storage, apply modifications, write back to Storage
         * TODO: lock DB for all UTXO with mutex right after forming mapUtxos and release it after applying patch or UTXO DB could be corrupted!
         *
         * @param {UTXO} utxo
         * @param {Number} nTxOutput - index in UTXO that we spend
         */
        spendCoins(utxo, nTxOutput) {
            typeforce('Number', nTxOutput);

            // no need to get in from this._data.coinsToRemove, because it store just ref to object that passed as param
            // just modify it and store in map. it will really store in for first time
            const strHash = utxo.getTxHash();
            utxo.spendCoins(nTxOutput);

            // rewrite reference
            this._data.coinsToRemove.set(strHash, utxo);
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

        getCoinsToRemove() {
            return this._data.coinsToRemove;
        }
    };
