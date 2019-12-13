'use strict';

const EventEmitter = require('events');
const path = require('path');
const assert = require('assert');
const levelup = require('levelup');
const leveldown = require('leveldown');
const typeforce = require('typeforce');
const debugLib = require('debug');
const util = require('util');
const fs = require('fs').promises;

const types = require('../types');
const {prepareForStringifyObject} = require('../utils');

const debug = debugLib('storage:');

const UTXO_PREFIX = 'c';
const BLOCK_INFO_PREFIX = 'H';
const CONTRACT_PREFIX = 'S';
const RECEIPT_PREFIX = 'R';
const LAST_APPLIED_BLOCKS = 'FINAL';
const PENDING_BLOCKS = 'PENDING';
const WALLET_PREFIX = 'w';
const WALLET_ADDRESSES = 'WALLETS';
const WALLET_AUTOINCREMENT = 'WALLET_AUTO_INC';
const TX_INDEX_PREFIX = 'T';
const INTENRAL_TX_INDEX_PREFIX = 'I';

const levelDbDestroy = util.promisify(leveldown.destroy);

/**
 *
 * @param db - levelup instance
 * @returns {Promise<any>}
 */
const eraseDbContent = async (db) => {
    const arrBuffers = [];
    await new Promise(resolve => {
        db.createKeyStream({keyAsBuffer: true, valueAsBuffer: false})
            .on('data', function(data) {
                arrBuffers.push({type: 'del', key: data});
//                db.del(data, {keyAsBuffer: true, valueAsBuffer: false});
            })
            .on('close', function() {
                resolve();
            });
    });
    await db.batch(arrBuffers);
};

module.exports = (factory, factoryOptions) => {
    const {
        Constants, Block, BlockInfo, UTXO, ArrayOfHashes, ArrayOfAddresses, Contract,
        TxReceipt, BaseConciliumDefinition, ConciliumRr, ConciliumPos, Peer, PatchDB
    } = factory;

    return class Storage extends EventEmitter {
        constructor(options) {
            options = {
                ...factoryOptions,
                ...options
            };

            super();

            const {testStorage, buildTxIndex, walletSupport, dbPath, mutex} = options;
            assert(mutex, 'Storage constructor requires Mutex instance!');

            if (testStorage) {

                // used for tests
                this._downAdapter = require('memdown');
            } else {
                this._downAdapter = leveldown;
            }

            this._pathPrefix = path.resolve(dbPath || Constants.DB_PATH_PREFIX);

            this._db = levelup(this._downAdapter(`${this._pathPrefix}/${Constants.DB_CHAINSTATE_DIR}`));

            // it's a good idea to keep blocks separately from UTXO DB
            // it will allow erase UTXO DB, and rebuild it from block DB
            // it could be levelDB also, but in different dir
            this._blockStorage = levelup(this._downAdapter(`${this._pathPrefix}/${Constants.DB_BLOCKSTATE_DIR}`));

            this._peerStorage = levelup(this._downAdapter(`${this._pathPrefix}/${Constants.DB_PEERSTATE_DIR}`));

            if (buildTxIndex) {
                this._buildTxIndex = true;
                this._txIndexStorage = levelup(this._downAdapter(`${this._pathPrefix}/${Constants.DB_TXINDEX_DIR}`));
            }

            // TODO: make it persistent after adding first address/key to wallet?
            if (walletSupport) {
                this._walletSupport = true;
                this._walletStorage = levelup(this._downAdapter(`${this._pathPrefix}/${Constants.DB_WALLET_DIR}`));
                this._strAccountPath = `${this._pathPrefix}/${Constants.DB_WALLET_DIR}/accounts`;
            }

            this._mutex = mutex;
        }

        /**
         *
         * @return {Promise<void>|*}
         */
        ready() {
            return Promise.resolve();
        }

        /**
         *
         * @param {String} strPrefix
         * @param {Buffer | undefined} buffKey
         * @param {Buffer | String} suffix
         * @returns {Buffer}
         */
        static createKey(strPrefix, buffKey, suffix = Buffer.from([])) {

            // Attention! no 'hex' encoding for strPrefix!!!!
            return buffKey ?
                Buffer.concat([Buffer.from(strPrefix), buffKey, Buffer.from(suffix)]) : Buffer.from(strPrefix);
        }

        static createUtxoKey(hash) {
            return this.createKey(UTXO_PREFIX, Buffer.from(hash, 'hex'));
        }

        static createInternalTxKey(hash) {
            return this.createKey(INTENRAL_TX_INDEX_PREFIX, Buffer.from(hash, 'hex'));
        }

        static createTxKey(hash) {
            return this.createKey(TX_INDEX_PREFIX, Buffer.from(hash, 'hex'));
        }

        async _ensureArrConciliumDefinition() {

            const lock = await this._mutex.acquire(['conciliums']);

            try {

                // cache is valid
                if (this._arrConciliumDefinition && this._arrConciliumDefinition.length) return;

                const cont = await this.getContract(
                    Buffer.from(Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS, 'hex'));

                if (cont) {
                    const {_arrConciliums} = cont.getData();
                    this._arrConciliumDefinition = _arrConciliums.map(objDefData => {
                        const baseDef = new BaseConciliumDefinition(objDefData);
                        if (baseDef.isPoS()) {
                            return new ConciliumPos(objDefData, Constants.concilium.POS_CONCILIUM_ROUNDS);
                        }
                        if (baseDef.isRoundRobin()) return new ConciliumRr(objDefData);
                    });
                } else {
                    this._arrConciliumDefinition = [];
                }
            } finally {
                this._mutex.release(lock);
            }
        }

        /**
         *
         * @param {Buffer | String} address
         * @returns {Promise<Array>} of BaseConciliumDefinition this address belongs to
         */
        async getConciliumsByAddress(address) {
            const buffAddress = Buffer.isBuffer(address) ? address : Buffer.from(address, 'hex');

            if (!Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS) return [];
            await this._ensureArrConciliumDefinition();

            const arrResult = [];
            for (let def of this._arrConciliumDefinition) {
                if ((def.isRoundRobin() || def.isPoS()) &&
                    ~def.getAddresses().findIndex(key => key.equals(buffAddress))) {
                    arrResult.push(def);
                }
            }
            return arrResult;
        }

        /**
         *
         * @param {Number} id
         * @returns {Promise<BaseConciliumDefinition>} publicKey belongs to
         */
        async getConciliumById(id) {

            if (!Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS) return undefined;
            await this._ensureArrConciliumDefinition();

            assert(id < this._arrConciliumDefinition.length, `ConciliumId "${id}" exceed number registered conciliums`);

            return this._arrConciliumDefinition[id];
        }

        async getConciliumsCount() {

            if (!Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS) return 0;
            await this._ensureArrConciliumDefinition();

            return this._arrConciliumDefinition.filter(def => def.isEnabled()).length;
        }

        async saveBlock(block, blockInfo) {
            const hash = block.hash();

            const buffHash = Buffer.isBuffer(hash) ? hash : Buffer.from(hash, 'hex');

            // save entire block
            // no prefix needed (because we using separate DB)
            const key = this.constructor.createKey('', buffHash);
            if (await this.hasBlock(hash)) {
                throw new Error(`Storage: Block ${buffHash.toString('hex')} already saved!`);
            }
            await this._blockStorage.put(key, block.encode());

            // save blockInfo
            if (!blockInfo) blockInfo = new BlockInfo(block.header);
            await this.saveBlockInfo(blockInfo);

            if (this._buildTxIndex) {
                await this._storeTxnsIndex(Buffer.from(block.getHash(), 'hex'), block.getTxHashes());
            }
        }

        /**
         * Did we ever received that block? We'll check BlockInfo storage (not block)!
         *
         * @param {String | Buffer} blockHash
         * @return {Promise<boolean>}
         */
        async hasBlock(blockHash) {
            typeforce(types.Hash256bit, blockHash);

            try {
                await this.getBlockInfo(blockHash);
                return true;
            } catch (e) {
                return false;
            }
        }

        /**
         * Remove entire block from storage.
         * It will keep it's BlockInfo!
         *
         * @param {String | Buffer} blockHash
         * @return {Promise<void>}
         */
        async removeBlock(blockHash) {
            typeforce(types.Hash256bit, blockHash);

            const bufHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash, 'hex');
            const key = this.constructor.createKey('', bufHash);
            await this._blockStorage.del(key);
        }

        /**
         * Return entire block!
         *
         * @param {String | Buffer} blockHash
         * @param {Boolean} raw
         * @return {Promise<Block | Buffer>}
         */
        async getBlock(blockHash, raw = false) {
            typeforce(types.Hash256bit, blockHash);

            const buffHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash, 'hex');

            // no prefix needed (because we using separate DB)
            const key = this.constructor.createKey('', buffHash);
            const buffBlock = await this._blockStorage.get(key).catch(err => debug(err));
            if (!buffBlock) throw new Error(`Storage: No block found by hash ${buffHash.toString('hex')}`);

            return raw ? buffBlock : new Block(buffBlock);
        }

        /**
         * Get BlockInfo @see proto/structures.proto
         *
         * @param {String | Buffer} blockHash
         * @param {Boolean} raw
         * @return {Promise<BlockInfo | Buffer>}
         */
        async getBlockInfo(blockHash, raw = false) {
            typeforce(types.Hash256bit, blockHash);

            const bufHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash, 'hex');
            const blockInfoKey = this.constructor.createKey(BLOCK_INFO_PREFIX, bufHash);

            const buffInfo = await this._db.get(blockInfoKey).catch(err => debug(err));
            if (!buffInfo) throw new Error(`Storage: No blockInfo found by hash ${bufHash.toString('hex')}`);

            return raw ? buffInfo : new BlockInfo(buffInfo);
        }

        /**
         * Get BlockInfo @see proto/structures.proto

         * @param {BlockInfo} blockInfo
         */
        async saveBlockInfo(blockInfo) {
            typeforce(types.BlockInfo, blockInfo);

            const blockInfoKey = this.constructor.createKey(BLOCK_INFO_PREFIX, Buffer.from(blockInfo.getHash(), 'hex'));
            await this._db.put(blockInfoKey, blockInfo.encode());
        }

        /**
         * Remove BlockInfo

         * @param {Buffer | String} blockHash
         */
        async removeBlockInfo(blockHash) {
            typeforce(types.Hash256bit, blockHash);

            const buffHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash, 'hex');

            const blockInfoKey = this.constructor.createKey(BLOCK_INFO_PREFIX, buffHash);
            await this._db.del(blockInfoKey);
        }

        /**
         * Set BlockInfo.isBad for specified hash
         * Remove from block storage, to save space
         *
         * @param {Set} setBlockHashes - keys are hashes
         * @return {Promise<void>}
         */
        async removeBadBlocks(setBlockHashes) {
            for (let blockHash of setBlockHashes) {
                const bi = await this.getBlockInfo(blockHash);
                bi.markAsBad();
                await this.saveBlockInfo(bi);
                await this.removeBlock(blockHash);
            }
        }

        /**
         * Throws error if we find UTXO with same hash
         * @see bip30 https://github.com/bitcoin/bitcoin/commit/a206b0ea12eb4606b93323268fc81a4f1f952531)
         *
         * @param {Array} arrTxHashes
         * @returns {Promise<void>}
         */
        async checkTxCollision(arrTxHashes) {
            for (let txHash of arrTxHashes) {
                try {
                    await this.getUtxo(txHash);
                } catch (e) {
                    continue;
                }
                throw new Error(`Tx collision for ${txHash}!`);
            }
        }

        /**
         *
         * @param {Array} arrUtxoHashes -
         * @returns {Promise<PatchDB>}  patch with coins from that UTXOs
         */
        async getUtxosPatch(arrUtxoHashes) {
            const patch = new PatchDB();

            const lock = await this._mutex.acquire(['utxo']);

            try {

                // TODO: test it against batch read performance
                for (let hash of arrUtxoHashes) {
                    try {
                        const utxo = await this.getUtxo(hash);
                        patch.setUtxo(utxo);
                    } catch (e) {
                        debug(e);
                    }
                }
            } finally {
                this._mutex.release(lock);
            }
            return patch;
        }

        /**
         *
         * @param {String | Buffer} hash - tx hash
         * @param {Boolean} raw
         * @returns {Promise<Buffer | UTXO>}
         */
        async getUtxo(hash, raw = false) {
            typeforce(types.Hash256bit, hash);

            const key = this.constructor.createUtxoKey(hash);

            const buffUtxo = await this._db.get(key).catch(err => debug(err));
            if (!buffUtxo) throw new Error(`Storage: UTXO with hash ${hash.toString('hex')} not found !`);

            return raw ? buffUtxo : new UTXO({txHash: hash, data: buffUtxo});
        }

        /**
         *
         * @param {PatchDB} statePatch
         * @returns {Promise<void>}
         */
        async applyPatch(statePatch) {

            const arrOps = [];
            const lock = await this._mutex.acquire(['utxo', 'contract', 'receipt', 'conciliums']);
            try {
                for (let [strTxHash, utxo] of statePatch.getCoins()) {
                    const key = this.constructor.createUtxoKey(strTxHash);
                    if (utxo.isEmpty()) {
                        arrOps.push({type: 'del', key});
                    } else {
                        arrOps.push({type: 'put', key, value: utxo.encode()});
                    }

                    if (this._walletSupport) await this._walletUtxoCheck(utxo);
                }

                // save contracts
                for (let [strContractAddr, contract] of statePatch.getContracts()) {

                    // if we change concilium contract - invalidate cache
                    if (Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS === strContractAddr) {
                        this._arrConciliumDefinition = undefined;
                    }
                    const key = this.constructor.createKey(CONTRACT_PREFIX, Buffer.from(strContractAddr, 'hex'));
                    arrOps.push({type: 'put', key, value: contract.encode()});
                }

                // save contract receipt
                // because we use receipts only for contracts, i decided to keep single txReceipts instead of array of receipts
                // for whole block
                for (let [strTxHash, receipt] of statePatch.getReceipts()) {
                    const key = this.constructor.createKey(RECEIPT_PREFIX, Buffer.from(strTxHash, 'hex'));
                    arrOps.push({type: 'put', key, value: receipt.encode()});

                    if (this._buildTxIndex) {
                        await this._storeInternalTxnsIndex(Buffer.from(strTxHash, 'hex'), receipt.getInternalTxns());
                    }
                }

                // BATCH WRITE
                await this._db.batch(arrOps);
            } finally {
                this._mutex.release(lock);

                if (!this._arrConciliumDefinition) this.emit('conciliumsChanged');
            }
        }

        /**
         *
         * @param {String} strTxHash
         * @param {Boolean} raw
         * @returns {Promise<any>}
         */
        getTxReceipt(strTxHash, raw) {
            typeforce(types.Hash256bit, strTxHash);

            return this._mutex.runExclusive(['receipt'], async () => {
                const key = this.constructor.createKey(RECEIPT_PREFIX, Buffer.from(strTxHash, 'hex'));
                const buffData = await this._db.get(key).catch(err => debug(err));
                if (!buffData) return undefined;

                return raw ? buffData : new TxReceipt(buffData);
            });
        }

        /**
         *
         * @param {Buffer | String} address
         * @param {Boolean} raw
         * @return {Promise<Contract | Buffer>}
         */
        getContract(address, raw = false) {
            typeforce(types.Address, address);

            address = Buffer.isBuffer(address) ? address : Buffer.from(address, 'hex');

            return this._mutex.runExclusive(['contract'], async () => {

                const key = this.constructor.createKey(CONTRACT_PREFIX, address);
                const buffData = await this._db.get(key).catch(err => debug(err));
                if (!buffData) return undefined;

                const contract = new Contract(buffData, address.toString('hex'));

                return raw ? buffData : contract;
            });
        }

        /**
         * the block hashes up to which the database represents the unspent transaction outputs.
         * @param {Boolean} raw
         * @return {Promise<Array>} of buffers. each is hash of last stable block
         */
        async getLastAppliedBlockHashes(raw = false) {
            const key = this.constructor.createKey(LAST_APPLIED_BLOCKS);

            return this._mutex.runExclusive(['lastAppliedBlock'], async () => {
                const result = await this._db.get(key).catch(err => debug(err));

                return raw ? result : (Buffer.isBuffer(result) ? (new ArrayOfHashes(result)).getArray() : []);
            });
        }

        /**
         * the block hashes up to which the database represents the unspent transaction outputs.
         *
         * @param {Array} arrBlockHashes
         * @return {Promise<void>}
         */
        async updateLastAppliedBlocks(arrBlockHashes) {
            typeforce(typeforce.arrayOf(types.Hash256bit), arrBlockHashes);

            const key = this.constructor.createKey(LAST_APPLIED_BLOCKS);

            // serialize and store
            const cArr = new ArrayOfHashes(arrBlockHashes);
            const lock = await this._mutex.acquire(['lastAppliedBlock']);

            try {
                await this._db.put(key, cArr.encode());
            } finally {
                this._mutex.release(lock);
            }
        }

        /**
         *
         * @param {Boolean} raw
         * @returns {Promise<ArrayOfHashes | Buffer>}
         */
        getPendingBlockHashes(raw = false) {
            const key = this.constructor.createKey(PENDING_BLOCKS);

            return this._mutex.runExclusive(['pending_blocks'], async () => {
                const result = await this._db.get(key).catch(err => debug(err));

                return raw ? result : (Buffer.isBuffer(result) ? (new ArrayOfHashes(result)).getArray() : []);
            });
        }

        updatePendingBlocks(arrBlockHashes) {
            typeforce(typeforce.arrayOf(types.Hash256bit), arrBlockHashes);

            const key = this.constructor.createKey(PENDING_BLOCKS);

            return this._mutex.runExclusive(['pending_blocks'], async () => {
                await this._db.put(key, (new ArrayOfHashes(arrBlockHashes)).encode());
            });
        }

        async savePeers(arrPeers) {
            const arrOps = [];

            let i = 0;
            for (let peer of arrPeers) {
                const key = Buffer.allocUnsafe(2);
                key.writeInt16BE(i++);
                arrOps.push({type: 'put', key, value: peer.peerInfo.encode()});
            }
            await this._peerStorage.batch(arrOps);
        }

        /**
         *
         * @returns {Promise<Array>} of Peers
         */
        async loadPeers() {
            let arrPeers = [];
            return new Promise((resolve, reject) => {
                this._peerStorage.createValueStream()
                    .on('data', buffPeer => arrPeers.push(new Peer({peerInfo: buffPeer})))
                    .on('close', () => resolve(arrPeers))
                    .on('error', err => reject(err));
            });
        }

        async getTxBlock(buffTxHash) {
            typeforce(types.Hash256bit, buffTxHash);

            if (!this._buildTxIndex) throw new Error('TxIndex disabled for this node');
            const key = this.constructor.createTxKey(buffTxHash);
            try {
                return await this._txIndexStorage.get(key);
            } catch (e) {
                debugLib(`Index for ${buffTxHash.toString('hex')} not found!`);
            }
            return undefined;
        }

        /**
         *
         * @param {String} strTxHash
         * @returns {Promise<Block>}
         */
        async findBlockByTxHash(strTxHash) {
            const buffTxHash = Buffer.from(strTxHash, 'hex');
            const blockHash = await this.getTxBlock(strTxHash);

            try {
                return blockHash ? await this.getBlock(blockHash) : undefined;
            } catch (e) {
                debugLib(`Block for ${strTxHash} not found!`);
            }
            return undefined;
        }

        /**
         *
         * @param {String} strTxHash - to find
         * @returns {Promise<Buffer>} - Source TX hash
         */
        async findInternalTx(strTxHash) {
            typeforce(types.Hash256bit, strTxHash);

            if (!this._buildTxIndex) throw new Error('TxIndex disabled for this node');

            const key = this.constructor.createInternalTxKey(Buffer.from(strTxHash, 'hex'));

            try {
                return await this._txIndexStorage.get(key);
            } catch (e) {
                debugLib(`Internal tx with hash ${strTxHash} not found!`);
            }
            return undefined;
        }

        async _ensureWalletInitialized() {
            if (!this._walletSupport) throw ('Wallet support is disabled');

            if (Array.isArray(this._arrStrWalletAddresses)) return;

            const lockAddr = await this._mutex.acquire(['walletAddresses']);
            try {
                const buffResult = await this._walletStorage.get(this.constructor.createKey(WALLET_ADDRESSES));
                this._arrStrWalletAddresses =
                    buffResult && Buffer.isBuffer(buffResult) ? (new ArrayOfAddresses(buffResult)).getArray() : [];
            } catch (e) {
                this._arrStrWalletAddresses = [];
            } finally {
                this._mutex.release(lockAddr);
            }

            const lockInc = await this._mutex.acquire(['walletIncrement']);
            try {
                const buffResult = await this._walletStorage.get(this.constructor.createKey(WALLET_AUTOINCREMENT));
                this._nWalletAutoincrement = buffResult.readUInt32BE();
            } catch (e) {
                this._nWalletAutoincrement = 0;
            } finally {
                this._mutex.release(lockInc);
            }

            await this._initAccounts();
        }

        /**
         * Get All records of strAddress
         * Keys are: <WALLET_PREFIX><buffAddress><idx>
         *     idx - could be discrete
         *
         * @param {String} strAddress
         * @return {Promise<Object>} {key, value: hash of utxo}
         * @private
         */
        _walletReadAddressRecords(strAddress) {
            typeforce(types.StrAddress, strAddress);

            const strLastIndex = new Array(10).fill('9').join('');

            const buffAddress = Buffer.from(strAddress, 'hex');
            const keyStart = this.constructor.createKey(WALLET_PREFIX, buffAddress);

            const keyEnd = this.constructor.createKey(WALLET_PREFIX, buffAddress, strLastIndex);

            return new Promise(resolve => {
                    const arrRecords = [];
                    this._walletStorage
                        .createReadStream({gte: keyStart, lte: keyEnd, keyAsBuffer: true, valueAsBuffer: true})
                        .on('data', (data) => arrRecords.push(data))
                        .on('close', () => resolve(arrRecords));
                }
            );
        }

        /**
         * We'll create a new record
         * key - <WALLET_PREFIX><buffAddress><idx>
         * value - Buffer from strHash
         *
         * And update WALLET_AUTOINCREMENT
         *
         * @param {String | Buffer} address - to add an UTXO
         * @param {String} strHash - hash of UTXO
         * @return {Promise<void>}
         * @private
         */
        async _walletWriteAddressUtxo(address, strHash) {
            typeforce(typeforce.tuple(types.Address, types.Hash256bit), [address, strHash]);
            await this._ensureWalletInitialized();

            const currentIdx = this._nWalletAutoincrement++;

            // prepare incremented value
            const buffLastIdx = Buffer.allocUnsafe(4);
            buffLastIdx.writeInt32BE(this._nWalletAutoincrement, 0);

            // store hash & autoincrement
            const key = this.constructor.createKey(WALLET_PREFIX, Buffer.from(address, 'hex'), currentIdx.toString());

            const lock = await this._mutex.acquire(['walletIncrement']);
            try {
                await this._walletStorage
                    .batch()
                    .put(this.constructor.createKey(WALLET_AUTOINCREMENT), buffLastIdx)
                    .put(key, Buffer.from(strHash, 'hex'))
                    .write();
            } finally {
                await this._mutex.release(lock);
            }
        }

        /**
         * UTXO could be spent, but index will still contain it.
         * Here we purge it
         *
         * @param {Array} arrBadKeys - [<WALLET_PREFIX><buffAddress><idx>]
         * @return {Promise<void>}
         * @private
         */
        async _walletCleanupMissed(arrBadKeys) {
            const arrOps = arrBadKeys.map(key => ({type: 'del', key}));
            await this._walletStorage.batch(arrOps);
        }

        /**
         * Check whether any of wallet addresses present in given UTXO
         *
         * @param {UTXO} utxo
         * @return {Promise<void>}
         * @private
         */
        async _walletUtxoCheck(utxo) {
            await this._ensureWalletInitialized();
            for (let strAddress of this._arrStrWalletAddresses) {
                const arrResult = utxo.getOutputsForAddress(strAddress);
                if (arrResult.length) {
                    await this._walletWriteAddressUtxo(strAddress, utxo.getTxHash());
                }
            }
        }

        /**
         *
         * @param {String} strAddress
         * @return {Promise<Array>} of UTXO that have coins of strAddress
         */
        async walletListUnspent(strAddress) {
            await this._ensureWalletInitialized();
            typeforce(types.Address, strAddress);

            assert(this._arrStrWalletAddresses.includes(strAddress), `${strAddress} not in wallet!`);

            const arrAddrRecords = await this._walletReadAddressRecords(strAddress);
            const arrKeysToCleanup = [];
            const arrResult = [];

            for (let {key, value: hash} of arrAddrRecords) {
                try {
                    const utxo = await this.getUtxo(hash);
                    arrResult.push(utxo);
                } catch (e) {
                    arrKeysToCleanup.push(key);
                }
            }

            if (arrKeysToCleanup.length) await this._walletCleanupMissed(arrKeysToCleanup);

            return arrResult.map(utxo => utxo.filterOutputsForAddress(strAddress));
        }

        async walletWatchAddress(address) {
            typeforce(types.Address, address);

            const strAddress = address.toString('hex');
            await this._ensureWalletInitialized();
            assert(!this._arrStrWalletAddresses.includes((strAddress)), `Address ${strAddress} already in wallet`);

            this._arrStrWalletAddresses.push(strAddress);
            await this._walletFlushAddresses();
        }

        /**
         * Flush all addresses from array into DB
         *
         * @return {Promise<void>}
         * @private
         */
        async _walletFlushAddresses() {
            await this._walletStorage.put(
                this.constructor.createKey(WALLET_ADDRESSES),
                new ArrayOfAddresses(this._arrStrWalletAddresses).encode()
            );
        }

        /**
         * Reindex whole wallet
         *
         * @return {Promise<void>}
         */
        async walletReIndex() {
            this._walletSupport = true;
            await this._ensureWalletInitialized();

            // clear wallet DB
            await eraseDbContent(this._walletStorage);

            // store all watched addresses
            await this._walletFlushAddresses();

            // reindex
            const keyStart = this.constructor.createUtxoKey(Buffer.from([]));
            const keyEnd = this.constructor.createUtxoKey(Buffer.from('F'.repeat(64), 'hex'));

            const arrRecords = [];
            await new Promise(resolve => {
                    this._db
                        .createReadStream({gte: keyStart, lte: keyEnd, keyAsBuffer: true, valueAsBuffer: true})
                        .on('data', async data => {

                            // get hash from key (slice PREFIX)
                            const hash = data.key.slice(1);
                            const utxo = new UTXO({txHash: hash, data: data.value});
                            for (let strAddr of this._arrStrWalletAddresses) {
                                const arrIndexes = utxo.getOutputsForAddress(strAddr);
//                                if (arrIndexes.length) await this._walletWriteAddressUtxo(strAddr, hash);
                                if (arrIndexes.length) arrRecords.push({strAddr, hash});
                            }
                        })
                        .on('close', () => resolve());
                }
            );
            for (const {strAddr, hash} of arrRecords) {
                await this._walletWriteAddressUtxo(strAddr, hash);
            }
        }

        async getWalletsAddresses() {
            await this._ensureWalletInitialized();
            return this._arrStrWalletAddresses;
        }

        /**
         * Key is buffTxHash
         * Value is buffBlockHash
         * TODO: to save space, store autoincremented idx -> blockHash, and buffTxHash ->idx
         *
         * @param {Buffer} buffBlockHash
         * @param {Array} arrTxnsHashes
         * @return {Promise<void>}
         * @private
         */
        async _storeTxnsIndex(buffBlockHash, arrTxnsHashes) {
            debug(`Storing TX index for ${buffBlockHash.toString('hex')}`);

            const arrOps = [];
            for (let strTxHash of arrTxnsHashes) {
                const key = this.constructor.createTxKey(strTxHash);
                arrOps.push({type: 'put', key, value: buffBlockHash});
            }

            // BATCH WRITE
            await this._txIndexStorage.batch(arrOps);
        }

        /**
         *
         * @param {Buffer} buffSourceTxHash - hash of original TX, produced all of those internal txns
         * @param {Array} arrInternalTxnsHashes - of internal TXns hashes (BUFFERS!)
         * @return {Promise<void>}
         * @private
         */
        async _storeInternalTxnsIndex(buffSourceTxHash, arrInternalTxnsHashes) {
            debug(`Storing internal TXns for ${buffSourceTxHash.toString('hex')}`);

            const arrOps = [];
            for (let strInternalTxHash of arrInternalTxnsHashes) {
                const key = this.constructor.createInternalTxKey(strInternalTxHash);
                arrOps.push({type: 'put', key, value: buffSourceTxHash});
            }

            // BATCH WRITE
            await this._txIndexStorage.batch(arrOps);
        }

        async dropAllForReIndex(bEraseBlockStorage = false) {
            if (typeof this._downAdapter.destroy === 'function') {

                await this._blockStorage.close();
                await this._db.close();
                await this._peerStorage.close();
                if (this._txIndexStorage) await this._txIndexStorage.close();
                if (this._walletStorage) await this._walletStorage.close();

                await levelDbDestroy(`${this._pathPrefix}/${Constants.DB_CHAINSTATE_DIR}`);
                await levelDbDestroy(`${this._pathPrefix}/${Constants.DB_PEERSTATE_DIR}`);
                await levelDbDestroy(`${this._pathPrefix}/${Constants.DB_TXINDEX_DIR}`);

                if (bEraseBlockStorage) {
                    console.log('INFO: erased blockstate!');
                    await levelDbDestroy(`${this._pathPrefix}/${Constants.DB_BLOCKSTATE_DIR}`);
                }
            }
        }

        async* readBlocks() {
            const it = this._blockStorage.iterator();
            const $_terminated = Symbol.for("terminated");

            while (true) {
                const next = await new Promise((r, x) => {
                    it.next(function(err, key, value) {
                        if (arguments.length === 0) r(undefined);
                        if (err === null && key === undefined && value === undefined) r(undefined);
                        if (err) x(err);
                        r({key: key, value: value});
                    });
                });
                if (next === undefined) { break; }
                if ((yield next) === $_terminated) {
                    await new Promise((r, x) => it.end((e) => (e ? x(x) : r())));
                    return;
                }
            }
        }

        async* readUtxos() {

            const keyStart = this.constructor.createUtxoKey(Buffer.from([]));
            const keyEnd = this.constructor.createUtxoKey(Buffer.from('F'.repeat(64), 'hex'));

            const it = this._db.iterator({gte: keyStart, lte: keyEnd, keyAsBuffer: true, valueAsBuffer: true});
            const $_terminated = Symbol.for("terminated");

            while (true) {
                const next = await new Promise((resolve, reject) => {
                    it.next(function(err, key, value) {
                        if (arguments.length === 0) resolve(undefined);
                        if (err === null && key === undefined && value === undefined) resolve(undefined);
                        if (err) reject(err);
                        resolve({key: key, value: value});
                    });
                });
                if (next === undefined) { break; }
                if ((yield next) === $_terminated) {
                    await new Promise((resolve, reject) => it.end((e) => (e ? reject(reject) : resolve())));
                    return;
                }
            }
        }

        async countWallets() {
            const setAddresses = new Set();
            for await (let {key, value} of this.readUtxos()) {
                const utxo = new UTXO({txHash: key.slice(UTXO_PREFIX.length), data: value});
                utxo.getReceivers().forEach(addr => setAddresses.add(addr));
            }
            return setAddresses.size;
        }

        async _initAccounts() {
            const strPath = `${this._strAccountPath}`;

            this._mapAccountAddresses = new Map();

            try {
                const stat = await fs.stat(strPath).catch(err => {});
                if (!stat || !stat.isDirectory()) {
                    await fs.mkdir(strPath);
                }
                const arrFileNames = await fs.readdir(strPath);

                for (let strDirName of arrFileNames) {
                    await this._readAccount(strDirName);
                }
            } catch (e) {
                logger.error('Account initialization failed', e);
            }
        }

        /**
         * Set this._mapAccountAddresses with addresses in account
         *
         * @param {String} strAccountName
         * @return {Promise<void>}
         * @private
         */
        async _readAccount(strAccountName) {
            const strPath = `${this._strAccountPath}/${strAccountName}`;
            const arrAddresses = await fs.readdir(strPath);
            this._mapAccountAddresses.set(strAccountName, arrAddresses);
        }

        async hasAccount(strAccountName) {
            await this._ensureWalletInitialized();

            return this._mapAccountAddresses.has(strAccountName);
        }

        async getAccountAddresses(strAccountName) {
            await this._ensureWalletInitialized();

            return this._mapAccountAddresses.get(strAccountName);
        }

        async createAccount(strAccountName) {
            const strPath = `${this._strAccountPath}/${strAccountName}`;

            await fs.mkdir(strPath);
            this._mapAccountAddresses.set(strAccountName, []);
        }

        /**
         *
         * @param {String} strAddress
         * @param {String }strAccountName
         * @param {Object} objEncryptedPk - @see Crypto.encrypt
         * @return {Promise<void>}
         */
        async writeKeyStore(strAddress, strAccountName, objEncryptedPk) {
            const strKeyStoreContent = JSON.stringify({
                address: 'Ux' + strAddress,
                ...prepareForStringifyObject(objEncryptedPk),
                version: 1.1
            });

            const strPath = `${this._strAccountPath}/${strAccountName}`;
            await fs.writeFile(`${strPath}/${strAddress}`, strKeyStoreContent);

            await this._readAccount(strAccountName);
        }

    };
};
