'use strict';

const typeforce = require('typeforce');
const debugLib = require('debug');
const {sleep} = require('../utils');
const types = require('../types');

const debug = debugLib('mempool:');

module.exports = ({Transaction}) =>
    class Mempool {
        constructor(options) {
            this._mapTxns = new Map();
            this._coinsCache = new Set();
        }

        /**
         * New block arrived, processed by app, here is array of hashes to remove
         * @param {Block} block
         */
        removeForBlock(block) {
            for (let objTx of block.txns) {
                const tx = new Transaction(objTx);

                // TODO: check could be here descendants (i.e. when we undo block, from misbehaving group). if so - implement queue
                this._mapTxns.delete(tx.strHash);
                this._removeTxCoinsFromCache(tx.coins);
                debug(`Block arrived: removed TX ${tx.strHash}`);
            }
        }

        hasTx(txHash) {
            typeforce(typeforce.oneOf('String', 'Buffer'), txHash);

            let strTxHash = Buffer.isBuffer(txHash) ? txHash.toString('hex') : txHash;
            return this._mapTxns.has(strTxHash);
        }

        /**
         * throws error!
         * used for wire tx (it's already validated)
         *
         * @param {Transaction} tx - transaction to add
         */
        addTx(tx) {
            const strHash = tx.strHash;
            if (this._mapTxns.has(strHash)) throw new Error(`tx ${strHash} already in mempool`);

            const arrCoins = tx.coins;
            this._addTxCoinsToCache(arrCoins);
            debug(`TX ${strHash} added`);
            this._mapTxns.set(strHash, {tx, arrived: Date.now()});
        }

        /**
         * Maintain cache ot utxos to be a frontier of double spend prevention
         * Consider using of bloom filters (to save memory) but false positives could ruin all
         *
         * @param arrCoins
         * @private
         */
        _addTxCoinsToCache(arrCoins) {
            arrCoins.forEach(hash => {
                const strHash = hash.toString('hex');
                if (this._coinsCache.has(strHash)) {
                    throw new Error(
                        `Mempool._addTxCoinsToCache: tx ${strHash} already in!`);
                }
                this._coinsCache.add(strHash);
            });
        }

        _removeTxCoinsFromCache(arrCoins) {
            arrCoins.forEach(hash => this._coinsCache.delete(hash.toString('hex')));
        }

        /**
         *
         * @param {Buffer | String} txHash
         * @return {Transaction}
         */
        getTx(txHash) {
            typeforce(typeforce.oneOf('String', 'Buffer'), txHash);

            let strTxHash = Buffer.isBuffer(txHash) ? txHash.toString('hex') : txHash;
            const tx = this._mapTxns.get(strTxHash);
            if (!tx) throw new Error(`Mempool: No tx found by hash ${strTxHash}`);

            debug(`retrieved TX ${strTxHash}`);
            return tx.tx;
        }
    };
