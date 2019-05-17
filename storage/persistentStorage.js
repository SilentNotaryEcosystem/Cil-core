'use strict';

const path = require('path');
const assert = require('assert');
const levelup = require('levelup');
const leveldown = require('leveldown');
const typeforce = require('typeforce');
const debugLib = require('debug');

const types = require('../types');

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

/**
 *
 * @param db - levelup instance
 * @returns {Promise<any>}
 */
const eraseDbContent = (db) => {
    return new Promise(resolve => {
        db.createKeyStream({keyAsBuffer: true, valueAsBuffer: false})
            .on('data', function(data) {
                db.del(data, {keyAsBuffer: true, valueAsBuffer: false});
            })
            .on('close', function() {
                resolve();
            });
    });
};

module.exports = (factory, factoryOptions) => {
    const {
        Constants, Block, BlockInfo, UTXO, ArrayOfHashes, ArrayOfAddresses, Contract,
        TxReceipt, ConciliumDefinition, Peer, PatchDB
    } = factory;

    return class Storage {
        constructor(options) {
            options = {
                ...factoryOptions,
                ...options
            };

            const {testStorage, buildTxIndex, walletSupport, dbPath, mutex} = options;
            assert(mutex, 'Storage constructor requires Mutex instance!');

            let downAdapter;
            if (testStorage) {

                // used for tests
                downAdapter = require('memdown');
            } else {
                downAdapter = leveldown;
            }

            const pathPrefix = path.resolve(dbPath || Constants.DB_PATH_PREFIX);

            this._db = levelup(downAdapter(`${pathPrefix}/${Constants.DB_CHAINSTATE_DIR}`));

            // it's a good idea to keep blocks separately from UTXO DB
            // it will allow erase UTXO DB, and rebuild it from block DB
            // it could be levelDB also, but in different dir
            this._blockStorage = levelup(downAdapter(`${pathPrefix}/${Constants.DB_BLOCKSTATE_DIR}`));

            this._peerStorage = levelup(downAdapter(`${pathPrefix}/${Constants.DB_PEERSTATE_DIR}`));

            if (buildTxIndex) {
                this._buildTxIndex = true;
                this._txIndexStorage = levelup(downAdapter(`${pathPrefix}/${Constants.DB_TXINDEX_DIR}`));
            }

            // TODO: make it persistent after adding first address/key to wallet?
            if (walletSupport) {
                this._walletSupport = true;
                this._walletStorage = levelup(downAdapter(`${pathPrefix}/${Constants.DB_WALLET_DIR}`));
            }

            this._mutex = mutex;
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

        async _ensureArrConciliumDefinition() {
            const cont = await this.getContract(Buffer.from(Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS, 'hex'));
            this._arrConciliumDefinition = cont ? ConciliumDefinition.getFromContractData(cont.getData()) : [];
        }

        /**
         *
         * @param {Buffer | String} publicKey
         * @returns {Promise<Array>} of ConciliumDefinition this publicKey belongs to
         */
        async getConciliumsByKey(publicKey) {
            const buffPubKey = Buffer.isBuffer(publicKey) ? publicKey : Buffer.from(publicKey, 'hex');

            if (!Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS) return [];
            await this._ensureArrConciliumDefinition();

            const arrResult = [];
            for (let def of this._arrConciliumDefinition) {
                if (~def.getPublicKeys().findIndex(key => key.equals(buffPubKey))) {
                    arrResult.push(def);
                }
            }
            return arrResult;
        }

        /**
         *
         * @param {Number} id
         * @returns {Promise<ConciliumDefinition>} publicKey belongs to
         */
        async getConciliumById(id) {

            if (!Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS) return undefined;
            await this._ensureArrConciliumDefinition();

            return id > this._arrConciliumDefinition.length ?
                undefined : this._arrConciliumDefinition[id];
        }

        async getConciliumsCount() {

            if (!Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS) return 0;
            await this._ensureArrConciliumDefinition();

            return this._arrConciliumDefinition.length;
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
                debug(`Storing TX index for ${block.getHash()}`);

                const arrOps = [];
                const buffBlockHash = Buffer.from(block.getHash(), 'hex');
                for (let strTxHash of block.getTxHashes()) {
                    const key = this.constructor.createKey('', Buffer.from(strTxHash, 'hex'));
                    arrOps.push({type: 'put', key, value: buffBlockHash});
                }

                // BATCH WRITE
                await this._txIndexStorage.batch(arrOps);
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
            if (!buffInfo) throw new Error(`Storage: No block found by hash ${bufHash.toString('hex')}`);

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

            // TODO: test it against batch read performance
            for (let hash of arrUtxoHashes) {
                try {
                    const utxo = await this.getUtxo(hash);
                    patch.setUtxo(utxo);
                } catch (e) {
                    debug(e);
                }
            }

            return patch;
        }

        /**
         *
         * @param {String | Buffer} hash - tx hash
         * @param {Boolean} raw
         * @returns {Promise<Buffer | UTXO>}
         */
        getUtxo(hash, raw = false) {
            typeforce(types.Hash256bit, hash);

            return this._mutex.runExclusive(['utxo'], async () => {
                const key = this.constructor.createUtxoKey(hash);

                const buffUtxo = await this._db.get(key).catch(err => debug(err));
                if (!buffUtxo) throw new Error(`Storage: UTXO with hash ${hash.toString('hex')} not found !`);

                return raw ? buffUtxo : new UTXO({txHash: hash, data: buffUtxo});
            });
        }

        /**
         *
         * @param {PatchDB} statePatch
         * @returns {Promise<void>}
         */
        async applyPatch(statePatch) {

            const arrOps = [];
            const lock = await this._mutex.acquire(['utxo', 'contract', 'receipt']);
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

                    // if we change concilium contract - update cache
                    if (Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS === strContractAddr) {
                        this._arrConciliumDefinition = contract.getData();
                    }
                    const key = this.constructor.createKey(CONTRACT_PREFIX, Buffer.from(strContractAddr, 'hex'));
                    arrOps.push({type: 'put', key, value: contract.encode()});
                }

                // save contract receipt
                // because we use receipts only for contracts, i decided to keep single txReceipts instead of array of receipts
                //      for whole block
                for (let [strTxHash, receipt] of statePatch.getReceipts()) {
                    const key = this.constructor.createKey(RECEIPT_PREFIX, Buffer.from(strTxHash, 'hex'));
                    arrOps.push({type: 'put', key, value: receipt.encode()});
                }

                // BATCH WRITE
                await this._db.batch(arrOps);
            } finally {
                this._mutex.release(lock);
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
            const result = await this._db.get(key).catch(err => debug(err));

            return raw ? result : (Buffer.isBuffer(result) ? (new ArrayOfHashes(result)).getArray() : []);
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
            await this._db.put(key, cArr.encode());
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
        loadPeers() {
            let arrPeers = [];
            return new Promise((resolve, reject) => {
                this._peerStorage.createValueStream()
                    .on('data', buffPeer => arrPeers.push(new Peer({peerInfo: buffPeer})))
                    .on('close', () => resolve(arrPeers))
                    .on('error', err => reject(err));
            });
        }

        /**
         *
         * @param {String} strTxHash
         * @returns {Promise<Block>}
         */
        async findBlockByTxHash(strTxHash) {
            typeforce(types.Hash256bit, strTxHash);

            if (!this._buildTxIndex) throw new Error('TxIndex disabled for this node');

            const key = this.constructor.createKey('', Buffer.from(strTxHash, 'hex'));

            try {
                const blockHash = await this._txIndexStorage.get(key);
                return await this.getBlock(blockHash);
            } catch (e) {
                debugLib(`Index or block for ${strTxHash} not found!`);
            }
            return undefined;
        }

        async _ensureWalletInitialized() {
            if (!this._walletSupport) throw ('Wallet support is disabled');

            if (Array.isArray(this._arrStrWalletAddresses)) return;

            try {
                const buffResult = await this._walletStorage.get(this.constructor.createKey(WALLET_ADDRESSES));
                this._arrStrWalletAddresses =
                    buffResult && Buffer.isBuffer(buffResult) ? (new ArrayOfAddresses(buffResult)).getArray() : [];
            } catch (e) {
                this._arrStrWalletAddresses = [];
            }

            try {
                const buffResult = await this._walletStorage.get(this.constructor.createKey(WALLET_AUTOINCREMENT));
                this._nWalletAutoincrement = buffResult.readUInt32BE();
            } catch (e) {
                this._nWalletAutoincrement = 0;
            }
        }

        /**
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

        async _walletWriteAddressUtxo(address, strHash) {
            typeforce(typeforce.tuple(types.Address, types.Hash256bit), [address, strHash]);
            await this._ensureWalletInitialized();

            const currentIdx = this._nWalletAutoincrement++;

            // prepare incremented value
            const buff = Buffer.allocUnsafe(4);
            buff.writeInt32BE(this._nWalletAutoincrement, 0);

            // store hash & autoincrement
            const key = this.constructor.createKey(WALLET_PREFIX, Buffer.from(address, 'hex'), currentIdx.toString());
            await this._walletStorage
                .batch()
                .put(this.constructor.createKey(WALLET_AUTOINCREMENT), buff)
                .put(key, Buffer.from(strHash, 'hex'))
                .write();
        }

        async _walletCleanupMissed(arrBadKeys) {
            const arrOps = arrBadKeys.map(key => ({type: 'del', key}));
            await this._walletStorage.batch(arrOps);
        }

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

            return arrResult;
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
            const keyEnd = this.constructor.createUtxoKey(Buffer.from('FF', 'hex'));

            await new Promise(resolve => {
                    this._db
                        .createReadStream({gte: keyStart, lte: keyEnd, keyAsBuffer: true, valueAsBuffer: true})
                        .on('data', async data => {

                            // get hash from key (slice PREFIX)
                            const hash = data.key.slice(1);
                            const utxo = new UTXO({txHash: hash, data: data.value});
                            for (let strAddr of this._arrStrWalletAddresses) {
                                const arrIndexes = utxo.getOutputsForAddress(strAddr);
                                if (arrIndexes.length) await this._walletWriteAddressUtxo(strAddr, hash);
                            }
                        })
                        .on('close', () => resolve());
                }
            );
        }

        async getWallets() {
            await this._ensureWalletInitialized();
            return this._arrStrWalletAddresses;
        }
    };
};
