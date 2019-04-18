'use strict';

const typeforce = require('typeforce');
const debugLib = require('debug');
const {sleep} = require('../utils');
const types = require('../types');
const Tick = require('tick-tock');

const debug = debugLib('mempool:');

// TODO: add tx expiration (14 days?)

module.exports = ({Constants, Transaction}) =>
    class Mempool {
        constructor(options) {
            this._mapTxns = new Map();
            this._tock = new Tick(this);
            this._tock.setInterval('outdatedTimer', this.purgeOutdated.bind(this), Constants.MEMPOOL_OUTDATED_INTERVAL);

        }

        /**
         * New block arrived, processed by app, here is array of hashes to remove
         * @param {Array} arrTxHashes
         */
        removeForBlock(arrTxHashes) {
            debug(`Block arrived: removed TXns ${arrTxHashes}`);
            this.removeTxns(arrTxHashes);
        }

        removeTxns(arrTxHashes) {
            for (let txHash of arrTxHashes) {

                // TODO: check could be here descendants (i.e. when we undo block, from misbehaving group). if so - implement queue
                // TODO: think about: is it problem that TX isn't present in mempool, but present in block
                if (this._mapTxns.has(txHash)) {
                    this._mapTxns.delete(txHash);
                } else {
                    debug(`removeTxns: no TX ${txHash} in mempool`);
                }
            }
        }

        purgeOutdated() {
            this._mapTxns.forEach((tx, hash) => {
                if (tx.arrived < Date.now() - Constants.MEMPOOL_TX_LIFETIME) {
                    this._mapTxns.delete(hash);
                }
            })
        }

        limitConstraints() {
            if (this._mapTxns.size < Constants.MEMPOOL_TX_QTY) return;
            let i = Math.floor(this._mapTxns.size / 3);
            for (let [hash, tx] of this._mapTxns) {
                this._mapTxns.delete(hash);
                if (--i == 0) break;
            }
        }

        hasTx(txHash) {
            typeforce(types.Hash256bit, txHash);

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
            this.limitConstraints();

            const strHash = tx.hash();
            if (this._mapTxns.has(strHash)) throw new Error(`tx ${strHash} already in mempool`);

            this._mapTxns.set(strHash, {tx, arrived: Date.now()});
            debug(`TX ${strHash} added`);
        }

        /**
         *
         * @param {Buffer | String} txHash
         * @return {Transaction}
         */
        getTx(txHash) {
            typeforce(types.Hash256bit, txHash);

            let strTxHash = Buffer.isBuffer(txHash) ? txHash.toString('hex') : txHash;
            const tx = this._mapTxns.get(strTxHash);
            if (!tx) throw new Error(`Mempool: No tx found by hash ${strTxHash}`);

            debug(`retrieved TX ${strTxHash}`);
            return tx.tx;
        }

        /**
         *
         * @param {Number} groupId - witness groupId
         * @returns {IterableIterator<any>} {tx, arrived ...}
         */
        getFinalTxns(groupId) {

            // TODO: implement lock_time
            // TODO: implement cache if mempool becomes huge
            const arrResult = [];
            for (let r of this._mapTxns.values()) {
                if (r.tx.witnessGroupId === groupId) arrResult.push(r.tx);
            }
            return this._sortTxns(arrResult);
        }
        /**
         * @param {Array<Transaction>} arrTxns array of tx
         * @returns sorted tx array
         */
        _sortTxns(arrTxns) {
            let hasConflict;
            do {
                hasConflict = false;
                for (let i in arrTxns) {
                    const tx = arrTxns[i];
                    const c = this._findConflicts(i, tx, arrTxns)
                    if (c >= 0) {
                        arrTxns.splice(c + 1, 0, tx);
                        arrTxns.splice(i, 1);
                        hasConflict = true;
                    }
                }
            } while (hasConflict)
            return arrTxns;
        }

        /**
         * 
         * @param {Number} txIndex - index of tx in arrTxns
         * @param {Transaction} tx - transaction for which the conflict is checked
         * @param {Array<Transaction>} arrTxns - array of all tx
         * @returns {Number} -1 if no conflict, else max index of tx in arrTxns
         *                   with which input tx has a conflict
         */
        _findConflicts(txIndex, tx, arrTxns) {
            let maxIndex = -1;
            for (const input of tx.inputs) {
                const index = arrTxns.findIndex(p => p.hash() == input.txHash.toString('hex'));
                if (index >= 0 && index > maxIndex) maxIndex = index;
            }
            if (maxIndex >= 0 && txIndex < maxIndex) {
                return maxIndex;
            }
            return -1;
        }
    };
