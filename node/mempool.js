'use strict';

const Tick = require('tick-tock');
const typeforce = require('typeforce');
const debugLib = require('debug');
const path = require('path');
const fs = require('fs');

const {sleep} = require('../utils');
const types = require('../types');

const debug = debugLib('mempool:');

const MEMPOOL_TIMER_NAME = 'mempoolTimer';
const MEMPOOL_TIMER_INTERVAL = 5 * 60 * 1000;

module.exports = ({Constants, Transaction}, factoryOptions) =>
    class Mempool {
        constructor(options = {}) {
            this._mapTxns = new Map();
            this._tock = new Tick(this);
            this._tock.setInterval(
                MEMPOOL_TIMER_NAME,
                this.purgeOutdated.bind(this),
                Constants.MEMPOOL_TX_LIFETIME
            );

            const {dbPath, testStorage} = {...factoryOptions, ...options};

            this._fileName = testStorage ? undefined : path.resolve(dbPath || Constants.DB_PATH_PREFIX,
                Constants.LOCAL_TX_FILE_NAME
            );

      this._mapConcilimTxns = new Map();
      this._mapLocalTxns = new Map();

      this._mapBadTxnsHash = new Map();
      this._setPreferredConciliums = new Set();
    }

    /**
     * New block arrived, processed by app, here is array of hashes to remove
     * @param {Array} arrTxHashes
     */
    removeForBlock(arrTxHashes) {
      debug(`Removed block TXns ${arrTxHashes}`);
      this.removeTxns(arrTxHashes);
    }

    removeTxns(arrTxHashes) {
      const prevSize = this._mapLocalTxns.size;

      for (let txHash of arrTxHashes) {
          
        // TODO: check could be here descendants (i.e. when we undo block, from misbehaving concilium). if so - implement queue
        // TODO: think about: is it problem that TX isn't present in mempool, but present in block
        let mapWithTx;
        if (this._mapLocalTxns.has(txHash)) {
          this._mapLocalTxns.delete(txHash);
        } else if ((mapWithTx = this._searchMapByHash(txHash))) {
          mapWithTx.delete(txHash);
        } else {
          debug(`removeTxns: no TX ${txHash} in mempool`);
        }
      }

      if (prevSize !== this._mapLocalTxns.size) this._dumpToDisk();
    }

    purgeOutdated() {
      // TODO: Delete the BadTxnsHash over 24hr
      this._mapBadTxnsHash.forEach((msecAdded, strHash) => {
        if (msecAdded < Date.now() - Constants.MEMPOOL_BAD_TX_CACHE)
          this._mapBadTxnsHash.delete(strHash);
      });

      // TODO: Delete ConcilimTxns over 24hr
      this._mapConcilimTxns.forEach((mapTxns) => {
        mapTxns.forEach((tx, hash) => {
          if (tx.arrived < Date.now() - Constants.MEMPOOL_TX_LIFETIME) {
            mapTxns.delete(hash);
          }
        });
      });
    }

    limitConstraints() {
        const nCurrentSize = this._calcSize();
        if (nCurrentSize < Constants.MEMPOOL_TX_QTY) return;

        const nTrimmedSize = Math.floor(2 * nCurrentSize / 3);

        // we have preferred
        if (this._setPreferredConciliums.size) {
            const nPrefferedSize = this._calcPrefferedSize();

            if (nPrefferedSize < Constants.MEMPOOL_TX_QTY) {

                // trim other, and keep maximum of preferred
                const arrMaps = [...this._mapConcilimTxns.keys()]
                    .filter(nConciliumId => !this._setPreferredConciliums.has(nConciliumId))
                    .map(nConciliumId => this._mapConcilimTxns.get(nConciliumId));

                this._purgeMaps(arrMaps, Constants.MEMPOOL_TX_QTY - nPrefferedSize);
            } else {

                // trim preffered
                const arrMaps = [...this._mapConcilimTxns.keys()]
                    .filter(nConciliumId => this._setPreferredConciliums.has(nConciliumId))
                    .map(nConciliumId => this._mapConcilimTxns.get(nConciliumId));
                this._purgeMaps(arrMaps, nTrimmedSize);

                // COMPLETELY remove OTHER
                [...this._mapConcilimTxns.keys()]
                    .filter(nConciliumId => !this._setPreferredConciliums.has(nConciliumId))
                    .forEach(nConciliumId => this._mapConcilimTxns.get(nConciliumId).clear());
            }
        } else {
            const arrMaps = [...this._mapConcilimTxns.keys()]
                .map(nConciliumId => this._mapConcilimTxns.get(nConciliumId));
            this._purgeMaps(arrMaps, nTrimmedSize);
        }
    }

    hasTx(txHash) {
        typeforce(types.Hash256bit, txHash);

        let strTxHash = Buffer.isBuffer(txHash) ? txHash.toString('hex') : txHash;
        return this._mapLocalTxns.has(strTxHash) ||
               this._mapBadTxnsHash.has(strTxHash) ||
               !!this._searchMapByHash(strTxHash);
    }

    /**
     * throws error!
     * used for wire tx (it's already validated)
     *
     * @param {Transaction} tx - transaction to add
     */
    addTx(tx) {
        const nConciliumId = tx.conciliumId;
        this._ensureConciliumTxns(nConciliumId);

        this.limitConstraints();

        const strHash = tx.getHash();
        if (this.hasTx(strHash)) throw new Error(`tx ${strHash} already in mempool`);

        const mapTxns = this._mapConcilimTxns.get(nConciliumId);
        mapTxns.set(strHash, {tx, arrived: Date.now()});

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

        const mapTxns = this._searchMapByHash(strTxHash);
        let tx = this._mapLocalTxns.get(strTxHash) || mapTxns.get(strTxHash);
        return tx.tx;
    }

    /**
     *
     * @param {Number} nConciliumId - witness nConciliumId
     * @returns {IterableIterator<any>} {tx, arrived ...}
     */
    getFinalTxns(nConciliumId) {

        // TODO: implement lock_time
        const arrResult = [];

        this._ensureConciliumTxns(nConciliumId);
        const mapTxns = this._mapConcilimTxns.get(nConciliumId);
        for (let [, r] of mapTxns) {
            arrResult.push(r.tx);
        }

        for (let r of this._mapLocalTxns.values()) {
            if (r.tx.conciliumId === nConciliumId) arrResult.push(r.tx);
        }
        return arrResult;
    }

    /**
     *
     * @return {[String]}
     */
    getLocalTxnHashes() {
        return [...this._mapLocalTxns.keys()];
    }

    /**
     *
     * @return {[{}]} - [{strTxHash, patchTx}]
     */
    getLocalTxnsPatches() {
        return [...this._mapLocalTxns].map(([strTxHash, {patchTx}]) => ({strTxHash, patchTx}));
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

        this._mapBadTxnsHash.set(strTxHash, Date.now());
    }

    isBadTx(strTxHash) {
        typeforce(types.Str64, strTxHash);

        return this._mapBadTxnsHash.has(strTxHash);
    }

    /**
     * We'll prefer to keep txns of that conciliums on purge
     * Used by witnesses
     *
     * @param arrIds
     */
    setPreferredConciliums(arrIds) {
        arrIds.forEach(nConciliumId => this._setPreferredConciliums.add(nConciliumId));
    }

    _ensureConciliumTxns(nConciliumId) {
        if (!this._mapConcilimTxns.has(nConciliumId)) this._mapConcilimTxns.set(nConciliumId, new Map());
    }

    /**
     *
     * @param {String} txHash
     * @return {Map | undefined}
     * @private
     */
    _searchMapByHash(txHash) {
        for (let [, mapTxns] of this._mapConcilimTxns) {
            if (mapTxns.has(txHash)) return mapTxns;
        }
        return undefined;
    }

    /**
     * Except local TXNs
     * @private
     */
    _calcSize() {
        let nTotalSize = 0;
        for (let [, mapTxns] of this._mapConcilimTxns) {
            nTotalSize += mapTxns.size;
        }
        return nTotalSize;
    }

    _calcPrefferedSize() {
        let nSize = 0;
        for (let nConciliumId of this._setPreferredConciliums) {
            const map = this._mapConcilimTxns.get(nConciliumId);
            nSize += map ? map.size : 0;
        }

        return nSize;
    }

    /**
     * Now it will proportionally remove most old txns in selected maps
     * TODO: keep most profitable txns, now
     *
     * @param arrMaps
     * @param nDesiredSize
     * @private
     */
    _purgeMaps(arrMaps, nDesiredSize) {

        const nCurrentSize = arrMaps.reduce((nSum, mapCurrent) => nSum + mapCurrent.size, 0);
        const nToRemove = nCurrentSize - nDesiredSize;

        for (let map of arrMaps) {
            let i = 0;
            const nThisMapRemove = Math.round(nToRemove * map.size / nCurrentSize);
            map.forEach((val, key) => {
                if (i++ < nThisMapRemove) map.delete(key);
            });
        }
    }

    /**
     *
     * @return {[String]} of all hashes contained in mempool
     */
    getContent() {
        const arrOfArrHashes = [];
        for (let [, mapTxns] of this._mapConcilimTxns) {
            arrOfArrHashes.push(Array.from(mapTxns.keys()));
        }
        arrOfArrHashes.push(Array.from(this._mapLocalTxns.keys()));

        return [].concat.apply([], arrOfArrHashes);
    }
};
