'use strict';

const levelup = require('levelup');
const leveldown = require('leveldown');
const typeforce = require('typeforce');
const util = require('util');
const debugLib = require('debug');

const types = require('../types');

const debug = debugLib('storage:dag:');
const levelDbDestroy = util.promisify(leveldown.destroy);

const BLOCK_INFO_PREFIX = 'H';
const MAIN_DAG_INDEX_PREFIX = 'I';
const MAIN_DAG_ORDER_PREFIX = 'O';
const MAIN_DAG_UNKNOWN_INDEX_PREFIX = 'U';

const MAIN_DAG_INDEX_STORE = 'mainDagIndexStore';

module.exports = (PersistentStorage, factory) => {
    const {Constants, BlockInfo} = factory;

    return class StorageWithDagIndex extends PersistentStorage {
        constructor(options) {
            super(options);
            this._initMainDagIndexDb();
        }

        _initMainDagIndexDb() {
            this._mainDagIndexStorage = levelup(
                this._downAdapter(`${this._pathPrefix}/${Constants.DB_MAIN_DAG_INDEX_DIR}`)
            );
        }

        async dropAllForReIndex(bEraseBlockStorage = false) {
            await super.dropAllForReIndex(bEraseBlockStorage);

            if (typeof this._downAdapter.destroy === 'function') {
                await this.close();
                await levelDbDestroy(`${this._pathPrefix}/${Constants.DB_MAINDAG_INDEX_DIR}`);
            }
        }

        async close() {
            if (this._mainDagIndexStorage) await this._mainDagIndexStorage.close();
            await super.close();
        }

        async getMainDagPageIndex(strDagPrefix, strPageIndex) {
            const lock = await this._mutex.acquire([MAIN_DAG_INDEX_STORE]);

            try {
                const strResult = await this._mainDagIndexStorage
                    .get(this.constructor.createDagKey(strDagPrefix, MAIN_DAG_INDEX_PREFIX, strPageIndex))
                    .catch(err => debug(err));
                if (!strResult) return null;
                return JSON.parse(strResult.toString());
            } finally {
                this._mutex.release(lock);
            }
        }

        async setMainDagPageIndex(strDagPrefix, strPageIndex, arrHashes) {
            const lock = await this._mutex.acquire([MAIN_DAG_INDEX_STORE]);

            try {
                await this._mainDagIndexStorage.put(
                    this.constructor.createDagKey(strDagPrefix, MAIN_DAG_INDEX_PREFIX, strPageIndex),
                    JSON.stringify(arrHashes)
                );
            } finally {
                this._mutex.release(lock);
            }
        }

        async getMainDagIndexOrder(strDagPrefix) {
            const lock = await this._mutex.acquire([MAIN_DAG_INDEX_STORE]);

            try {
                const result = await this._mainDagIndexStorage
                    .get(this.constructor.createDagKey(strDagPrefix, MAIN_DAG_ORDER_PREFIX, 'order'))
                    .catch(err => debug(err));
                return result ? +result.toString() : 0;
            } finally {
                this._mutex.release(lock);
            }
        }

        async decMainDagIndexOrder(strDagPrefix) {
            await this.incMainDagIndexOrder(strDagPrefix, -1);
        }

        async incMainDagIndexOrder(strDagPrefix, nIncValue = 1) {
            const lock = await this._mutex.acquire([MAIN_DAG_INDEX_STORE]);

            try {
                const strKey = this.constructor.createDagKey(strDagPrefix, MAIN_DAG_ORDER_PREFIX, 'order');
                const result = await this._mainDagIndexStorage.get(strKey).catch(err => debug(err));
                await this._mainDagIndexStorage.put(strKey, (result ? +result.toString() : 0) + nIncValue);
            } finally {
                this._mutex.release(lock);
            }
        }

        /**
         * Get BlockInfo @see proto/structures.proto
         *
         * @param {String | Buffer} blockHash
         * @param {Boolean} raw
         * @return {Promise<BlockInfo | Buffer>}
         */
        getDagBlockInfo(strDagPrefix, blockHash, raw = false) {
            typeforce(types.Hash256bit, blockHash);

            return this._mutex.runExclusive(MAIN_DAG_INDEX_STORE, async () => {
                const bufHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash, 'hex');
                const blockInfoKey = this.constructor.createDagKey(strDagPrefix, BLOCK_INFO_PREFIX, bufHash);

                // console.log('read blockHash', blockHash, blockInfoKey);

                const buffInfo = await this._mainDagIndexStorage.get(blockInfoKey).catch(err => debug(err));

                if (!buffInfo) throw new Error(`Storage: No blockInfo found by hash ${bufHash.toString('hex')}`);

                return raw ? buffInfo : new BlockInfo(buffInfo);
            });
        }

        /**
         * Get BlockInfo @see proto/structures.proto

         * @param {BlockInfo} blockInfo
         */
        async saveDagBlockInfo(strDagPrefix, blockInfo) {
            typeforce(types.BlockInfo, blockInfo);

            const lock = await this._mutex.acquire(['blockInfoStore']);

            try {
                const blockInfoKey = this.constructor.createDagKey(
                    strDagPrefix,
                    BLOCK_INFO_PREFIX,
                    Buffer.from(blockInfo.getHash(), 'hex')
                );

                await this._mainDagIndexStorage.put(blockInfoKey, blockInfo.encode());
            } finally {
                this._mutex.release(lock);
            }
        }

        /**
         * Remove BlockInfo

         * @param {Buffer | String} blockHash
         */
        async removeDagBlockInfo(strDagPrefix, blockHash) {
            typeforce(types.Hash256bit, blockHash);

            const buffHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash, 'hex');

            const blockInfoKey = this.constructor.createDagKey(strDagPrefix, BLOCK_INFO_PREFIX, buffHash);
            await this._mainDagIndexStorage.del(blockInfoKey);
        }

        /**
         *
         * @param {String} strDbPrefix
         * @param {String} strTypePrefix
         * @param {Buffer | String} key
         * @returns {Buffer}
         */
        static createDagKey(strDbPrefix, strTypePrefix, key) {
            return Buffer.concat([
                Buffer.from(strDbPrefix),
                Buffer.from(strTypePrefix),
                Buffer.isBuffer(key) ? key : Buffer.from(key.toString())
            ]);
        }
    };
};
