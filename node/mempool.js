'use strict';

const Tick = require('tick-tock');
const typeforce = require('typeforce');
const debugLib = require('debug');
const path = require('path');
const fs = require('fs');

const {sleep} = require('../utils');
const types = require('../types');

const debug = debugLib('mempool:');

// TODO: add tx expiration (14 days?)

module.exports = ({Constants, Transaction}) =>
    class Mempool {
        constructor(options = {}) {
            this._mapTxns = new Map();
            this._tock = new Tick(this);
            this._tock.setInterval('outdatedTimer', this.purgeOutdated.bind(this), Constants.MEMPOOL_OUTDATED_INTERVAL);

            const {dbPath, testStorage} = options;

            this._fileName = path.resolve(dbPath || Constants.DB_PATH_PREFIX, Constants.LOCAL_TX_FILE_NAME);
            this._mapLocalTxns = new Map();

            if (testStorage) {
                this._loadFromDisk = this._dumpToDisk = () => {};
            } else {
                this._loadFromDisk();
            }
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
            const prevSize = this._mapLocalTxns.size;

            for (let txHash of arrTxHashes) {

                // TODO: check could be here descendants (i.e. when we undo block, from misbehaving concilium). if so - implement queue
                // TODO: think about: is it problem that TX isn't present in mempool, but present in block
                if (this._mapTxns.has(txHash)) {
                    this._mapTxns.delete(txHash);
                } else if (this._mapLocalTxns.has(txHash)) {
                    this._mapLocalTxns.delete(txHash);
                } else {
                    debug(`removeTxns: no TX ${txHash} in mempool`);
                }

                if (prevSize !== this._mapLocalTxns.size) this._dumpToDisk();
            }
        }

        purgeOutdated() {
            this._mapTxns.forEach((tx, hash) => {
                if (tx.arrived < Date.now() - Constants.MEMPOOL_TX_LIFETIME) {
                    this._mapTxns.delete(hash);
                }
            });
        }

        limitConstraints() {
            if (this._mapTxns.size < Constants.MEMPOOL_TX_QTY) return;
            let i = Math.floor(this._mapTxns.size / 3);
            for (let [hash, tx] of this._mapTxns) {
                this._mapTxns.delete(hash);
                if (--i === 0) break;
            }
        }

        hasTx(txHash) {
            typeforce(types.Hash256bit, txHash);

            let strTxHash = Buffer.isBuffer(txHash) ? txHash.toString('hex') : txHash;
            return this._mapTxns.has(strTxHash) || this._mapLocalTxns.has(strTxHash);
        }

        /**
         * throws error!
         * used for wire tx (it's already validated)
         *
         * @param {Transaction} tx - transaction to add
         */
        addTx(tx) {
            this.limitConstraints();

            const strHash = tx.getHash();
            if (this.hasTx(strHash)) throw new Error(`tx ${strHash} already in mempool`);

            this._mapTxns.set(strHash, {tx, arrived: Date.now()});
            debug(`TX ${strHash} added`);
        }

        /**
         * throws error!
         * used for wire tx (it's already validated)
         *
         * @param {Transaction} tx - transaction to add
         */
        addLocalTx(tx) {

            const strHash = tx.getHash();
            if (this.hasTx(strHash)) throw new Error(`Local tx ${strHash} already in mempool`);

            this._mapLocalTxns.set(strHash, tx);
            debug(`Local TX ${strHash} added`);

            this._dumpToDisk();
        }

        /**
         *
         * @param {Buffer | String} txHash
         * @return {Transaction}
         */
        getTx(txHash) {
            typeforce(types.Hash256bit, txHash);

            let strTxHash = Buffer.isBuffer(txHash) ? txHash.toString('hex') : txHash;
            if (!this.hasTx(strTxHash)) throw new Error(`Mempool: No tx found by hash ${strTxHash}`);
            let tx = this._mapTxns.get(strTxHash);

            if (tx) return tx.tx;
            return this._mapLocalTxns.get(strTxHash);
        }

        /**
         *
         * @param {Number} conciliumId - witness conciliumId
         * @returns {IterableIterator<any>} {tx, arrived ...}
         */
        getFinalTxns(conciliumId) {

            // TODO: implement lock_time
            // TODO: implement cache if mempool becomes huge
            const arrResult = [];
            for (let r of this._mapTxns.values()) {
                if (r.tx.conciliumId === conciliumId) arrResult.push(r.tx);
            }

            for (let tx of this._mapLocalTxns.values()) {
                if (tx.conciliumId === conciliumId) arrResult.push(tx);
            }
            return arrResult;
        }

        /**
         *
         * @return {string[]}
         */
        getLocalTxnHashes() {
            return [...this._mapLocalTxns.keys()];
        }

        /**
         *
         * @return {Array}
         */
        getAllTxnHashes() {
            return [].concat([...this._mapLocalTxns.keys()], [...this._mapTxns.keys()]);
        }

        _dumpToDisk() {
            debug('Dumping to disk');
            const objToSave = {};
            for (let [txHash, tx] of this._mapLocalTxns) {
                objToSave[txHash] = tx.encode().toString('hex');
            }

            fs.writeFileSync(this._fileName, JSON.stringify(objToSave, undefined, 2));
        }

        _loadFromDisk() {
            try {
                const objTxns = JSON.parse(fs.readFileSync(this._fileName, 'utf8'));
                for (let strHash of Object.keys(objTxns)) {
                    this._mapLocalTxns.set(strHash, new Transaction(Buffer.from(objTxns[strHash], 'hex')));
                }
            } catch (e) {
                if (!e.message.match(/ENOENT/)) logger.error(e);
            }
        }
    };
