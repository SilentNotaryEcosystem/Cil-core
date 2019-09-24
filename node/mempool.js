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

module.exports = ({Constants, Transaction}, factoryOptions) =>
    class Mempool {
        constructor(options = {}) {
            this._mapTxns = new Map();
            this._tock = new Tick(this);
            this._tock.setInterval('outdatedTimer', this.purgeOutdated.bind(this), Constants.MEMPOOL_OUTDATED_INTERVAL);

            const {dbPath, testStorage} = {...factoryOptions, ...options};

            this._fileName = testStorage ? undefined : path.resolve(dbPath || Constants.DB_PATH_PREFIX,
                Constants.LOCAL_TX_FILE_NAME
            );
            this._mapLocalTxns = new Map();

            this._setBadTxnsHash = new Set();
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

        /**
         *
         * @return {Boolean}
         */
        limitConstraints() {
            if (this._mapTxns.size < Constants.MEMPOOL_TX_QTY) {
                return false;
            }
            let i = Math.floor(this._mapTxns.size / 3);
            for (let [hash, tx] of this._mapTxns) {
                this._mapTxns.delete(hash);
                if (--i === 0) break;
            }
            return true;
        }

        /**
         *
         * @return {Boolean}
         */
        validateTxns() {
            if (this.limitConstraints()) {
                debug(`Reduction memPool size according the limit MEMPOOL_TX_QTY ${Constants.MEMPOOL_TX_QTY}`);
            }
            this.getAllTxnHashes().forEach((hash) => {
                if (typeof hash !== 'string') {
                    debug(`Wrong txn hash type ${hash}`);
                    return false;
                }
                if (hash.length !== 64) {
                    debug(`Wrong txn hash length ${hash}`);
                    return false;
                }

                const testTnx = this.getTx(hash);

                if (typeof testTnx._data != 'object') {
                    debug(`Wrong _data txn ${hash}`);
                    return false;
                }
                if (typeof testTnx._data.payload != 'object') {
                    debug(`Wrong _data.payload txn ${hash}`);
                    return false;
                }
                if (typeof testTnx._data.payload.ins != 'object') {
                    debug(`Wrong _data.payload.ins txn ${hash}`);
                    return false;
                }
                if (typeof testTnx._data.payload.outs != 'object') {
                    debug(`Wrong _data.payload.outs txn ${hash}`);
                    return false;
                }
                // todo : clarify validation requiments
                return true;
            });
        }

        hasTx(txHash) {
            typeforce(types.Hash256bit, txHash);

            let strTxHash = Buffer.isBuffer(txHash) ? txHash.toString('hex') : txHash;
            return this._mapTxns.has(strTxHash) ||
                   this._mapLocalTxns.has(strTxHash) ||
                   this._setBadTxnsHash.has(txHash);
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
         * could be replaced with patch, because it loaded without patches
         *
         * @param {Transaction} tx - transaction to add
         * @param {PatchDB} patchTx - patch for this tx (result of tx exec)
         * @param {Boolean} suppressDump - @see loadLocalTxnsFromDisk
         */
        addLocalTx(tx, patchTx, suppressDump = false) {
            typeforce(types.Transaction, tx);

            const strHash = tx.getHash();
            const prevSize = this._mapLocalTxns.size;

            this._mapLocalTxns.set(strHash, {tx, patchTx});
            debug(`Local TX ${strHash} added`);

            if (!suppressDump && prevSize !== this._mapLocalTxns.size) this._dumpToDisk();
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
            let tx = this._mapTxns.get(strTxHash) || this._mapLocalTxns.get(strTxHash);
            return tx.tx;
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

            for (let r of this._mapLocalTxns.values()) {
                if (r.tx.conciliumId === conciliumId) arrResult.push(r.tx);
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
         * @return {Array[{strTxHash, patchTx}]}
         */
        getLocalTxnsPatches() {
            return [...this._mapLocalTxns].map(([strTxHash, {tx, patchTx}]) => ({strTxHash, patchTx}));
        }

        /**
         *
         * @return {Array}
         */
        getAllTxnHashes() {
            return [].concat([...this._mapLocalTxns.keys()], [...this._mapTxns.keys()]);
        }

        _dumpToDisk() {
            if (!this._fileName) return;

            debug('Dumping to disk');
            const objToSave = {};
            for (let [txHash, {tx}] of this._mapLocalTxns) {
                objToSave[txHash] = tx.encode().toString('hex');
            }

            fs.writeFileSync(this._fileName, JSON.stringify(objToSave, undefined, 2));
        }

        loadLocalTxnsFromDisk() {
            if (!this._fileName) return;

            try {
                const objTxns = JSON.parse(fs.readFileSync(this._fileName, 'utf8'));
                for (let strHash of Object.keys(objTxns)) {
                    this.addLocalTx(new Transaction(Buffer.from(objTxns[strHash], 'hex')), undefined, true);
                }
            } catch (e) {
                if (!e.message.match(/ENOENT/)) logger.error(e);
            }
        }

        storeBadTxHash(strTxHash) {
            typeforce(types.Str64, strTxHash);

            this._setBadTxnsHash.add(strTxHash);
        }

        isBadTx(strTxHash) {
            typeforce(types.Str64, strTxHash);

            return this._setBadTxnsHash.has(strTxHash);
        }
    };
