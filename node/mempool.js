'use strict';

const typeforce = require('typeforce');
const debugLib = require('debug');
const {sleep} = require('../utils');
const types = require('../types');

const debug = debugLib('mempool:');

// TODO: add tx expiration (14 days?)

module.exports = ({Transaction}) =>
    class Mempool {
        constructor(options) {
            this._mapTxns = new Map();
            this._coinsCache = new Set();
        }

        /**
         * New block arrived, processed by app, here is array of hashes to remove
         * @param {Array} arrTxHashes
         */
        removeForBlock(arrTxHashes) {
            for (let txHash of arrTxHashes) {

                // TODO: check could be here descendants (i.e. when we undo block, from misbehaving group). if so - implement queue
                // TODO: think about: is it problem that TX isn't present in mempool, but present in block
                if (this._mapTxns.has(txHash)) {
                    const {tx} = this._mapTxns.get(txHash);

                    this._mapTxns.delete(txHash);
                    debug(`Block arrived: removed TX ${txHash}`);
                } else {
                    debug(`Block arrived: but no TX ${txHash} in mempool`);
                }
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
            const strHash = tx.hash();
            if (this._mapTxns.has(strHash)) throw new Error(`tx ${strHash} already in mempool`);

            // TODO: implement check for double spend by different witness group
            this._mapTxns.set(strHash, {tx, arrived: Date.now()});
            debug(`TX ${strHash} added`);
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

        /**
         *
         * @returns {IterableIterator<any>} - iterator of {tx, arrived ...}
         */
        getFinalTxns() {

            // TODO: implement lock_time
            return this._mapTxns.values();
        }
    };
