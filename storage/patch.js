'use strict';
const assert = require('assert');
const typeforce = require('typeforce');
const debugLib = require('debug');
const types = require('../types');
const {arrayIntersection} = require('../utils');

const debug = debugLib('patch:');

// Could be used for undo blocks

module.exports = ({UTXO, Coins}) =>
    class PatchDB {
        constructor() {
            this._data = {
                coins: new Map()
            };

            this._mapSpentUtxos = new Map();
        }

        /**
         * TODO: reminder. lock DB for all UTXO with mutex right after forming mapUtxos
         * TODO: and release it after applying patch or UTXO DB could be corrupted!
         *
         * @param {UTXO} utxo
         * @param {Number} nTxOutput - index in UTXO that we spend
         * @param {String | Buffer} txHashSpent - hash of tx that spent this output (used for merging patches).
         */
        spendCoins(utxo, nTxOutput, txHashSpent) {
            typeforce('Number', nTxOutput);
            typeforce(types.Hash256bit, txHashSpent);

            if (typeof txHashSpent === 'string') txHashSpent = Buffer.from(txHashSpent, 'hex');

            const strHash = utxo.getTxHash();
            const utxoCopy = this.getUtxo(strHash) || utxo.clone();
            utxoCopy.spendCoins(nTxOutput);

            // rewrite reference
            this._data.coins.set(strHash, utxoCopy);

            this._setSpentOutput(utxo.getTxHash(), nTxOutput, txHashSpent);
        }

        /**
         *
         * @param {String | Buffer} txHash
         * @param {Number} idx
         * @param {Coins} coins
         */
        createCoins(txHash, idx, coins) {
            typeforce(typeforce.tuple(types.Hash256bit, 'Number'), [txHash, idx]);

            if (Buffer.isBuffer(txHash)) txHash = txHash.toString('hex');

            const utxo = this._data.coins.get(txHash) || new UTXO({txHash});
            utxo.addCoins(idx, coins);

            this._data.coins.set(txHash, utxo);
        }

        /**
         *
         * @returns {Map} of UTXOs. keys are hashes, values UTXOs
         */
        getCoins() {
            return this._data.coins;
        }

        /**
         *
         * @param {String} txHash
         * @returns {UTXO}
         */
        getUtxo(txHash) {
            typeforce(types.Str64, txHash);

            return this._data.coins.get(txHash);
        }

        merge(patch) {
            const resultPatch = new PatchDB();
            const arrThisCoinsHashes = Array.from(this._data.coins.keys());
            const arrAnotherCoinsHashes = Array.from(patch._data.coins.keys());

            const setUnionHases = new Set(arrThisCoinsHashes.concat(arrAnotherCoinsHashes));
            for (let coinHash of setUnionHases) {
                if ((this._data.coins.has(coinHash) && !patch._data.coins.has(coinHash)) ||
                    (!this._data.coins.has(coinHash) && patch._data.coins.has(coinHash))) {

                    // only one patch have this utxo -> put it in result
                    const utxo = this._data.coins.get(coinHash) || patch._data.coins.get(coinHash);
                    const mapSpentOutputs = this._getSpentOutputs(coinHash) || patch._getSpentOutputs(coinHash);

                    resultPatch._data.coins.set(coinHash, utxo.clone());
                    for (let [idx, hash] of mapSpentOutputs) resultPatch._setSpentOutput(coinHash, idx, hash);

                } else {

                    // both has (if both doesn't have some, there will be no that hash in setUnionHases)
                    const utxoMy = this.getUtxo(coinHash);
                    const utxoHis = patch.getUtxo(coinHash);

                    // if both version of UTXO has index -> put it in result
                    // if only one has - this means it's spent -> don't put it in result
                    // if both doesn't have - check it for double spend. if found - throws
                    // so if we need only intersection we could travers any for indexes
                    for (let idx of utxoMy.getIndexes()) {
                        try {
                            const coins = utxoHis.coinsAtIndex(idx);

                            // put it in result
                            resultPatch.createCoins(coinHash, idx, coins);
                        } catch (e) {

                            // not found
                        }
                    }

                    // all good utxos added to resulting patch now search for double spends
                    const mapMySpentOutputs = this._getSpentOutputs(coinHash);
                    const mapHisSpentOutputs = patch._getSpentOutputs(coinHash);
                    const arrSpentIndexes = arrayIntersection(
                        Array.from(mapMySpentOutputs.keys()),
                        Array.from(mapHisSpentOutputs.keys())
                    );
                    for (let idx of arrSpentIndexes) {
                        assert(
                            mapMySpentOutputs.get(idx).equals(mapHisSpentOutputs.get(idx)),
                            `Conflict on ${coinHash} idx ${idx}`
                        );
                    }

                    // no conflicts - store all spendings into resulting patch
                    for (let [idx, hash] of mapMySpentOutputs) resultPatch._setSpentOutput(coinHash, idx, hash);
                    for (let [idx, hash] of mapHisSpentOutputs) resultPatch._setSpentOutput(coinHash, idx, hash);
                }
            }

            return resultPatch;
        }

        /**
         * We need it to prevent patch growth.
         * When block becomes stable - we apply it to storage and purge those UTXOs from derived patches
         *
         * @param {PatchDB} patch - another instance, that we remove from current.
         */
        purge(patch) {
            const arrAnotherCoinsHashes = Array.from(patch._data.coins.keys());
            for (let hash of arrAnotherCoinsHashes) {

                // keep UTXO if it was changed
                const utxo = this.getUtxo(hash);
                if (!utxo.equals(patch.getUtxo(hash))) continue;

                // remove it, if unchanged since (patch)
                this._data.coins.delete(utxo.getTxHash());
                this._mapSpentUtxos.delete(utxo.getTxHash());
            }
        }

        _setSpentOutput(strUtxoHash, nTxOutput, buffTxHashSpent) {
            let mapSpent = this._mapSpentUtxos.get(strUtxoHash);
            if (!mapSpent) mapSpent = new Map();
            mapSpent.set(nTxOutput, buffTxHashSpent);
            this._mapSpentUtxos.set(strUtxoHash, mapSpent);
        }

        _getSpentOutputs(strUtxoHash) {
            return this._mapSpentUtxos.get(strUtxoHash) || new Map();
        }
    };
