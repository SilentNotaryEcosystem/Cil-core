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

/**
 *
 * @param {String} strPrefix
 * @param {Buffer | undefined} buffKey
 * @returns {Buffer}
 */
const createKey = (strPrefix, buffKey) => {

    // Attention! no 'hex' encoding for strPrefix!
    return buffKey ? Buffer.concat([Buffer.from(strPrefix), buffKey]) : Buffer.from(strPrefix);
};

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
    const {Constants, Block, BlockInfo, UTXO, ArrayOfHashes, Contract, TxReceipt, WitnessGroupDefinition, Peer, Transport} = factory;
    return class Storage {
        constructor(options) {
            options = {
                ...factoryOptions,
                ...options
            };

            const {testStorage, dbPath, mutex} = options;
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

            this._mutex = mutex;
        }

        async _ensureArrGroupDefinition() {
            const cont = await this.getContract(Buffer.from(Constants.GROUP_DEFINITION_CONTRACT_ADDRESS, 'hex'));
            this._arrGroupDefinition = cont ? WitnessGroupDefinition.getFromContractData(cont.getData()) : [];
        }

        /**
         *
         * @param {Buffer | String} publicKey
         * @returns {Promise<Array>} of WitnessGroupDefinition this publicKey belongs to
         */
        async getWitnessGroupsByKey(publicKey) {
            const buffPubKey = Buffer.isBuffer(publicKey) ? publicKey : Buffer.from(publicKey, 'hex');

            if (!Constants.GROUP_DEFINITION_CONTRACT_ADDRESS) return [];
            await this._ensureArrGroupDefinition();

            const arrResult = [];
            for (let def of this._arrGroupDefinition) {
                if (~def.getPublicKeys().findIndex(key => key.equals(buffPubKey))) {
                    arrResult.push(def);
                }
            }
            return arrResult;
        }

        /**
         *
         * @param {Number} id
         * @returns {Promise<WitnessGroupDefinition>} of groupDefinition publicKey belongs to
         */
        async getWitnessGroupById(id) {

            if (!Constants.GROUP_DEFINITION_CONTRACT_ADDRESS) return undefined;
            await this._ensureArrGroupDefinition();

            return id > this._arrGroupDefinition.length ?
                undefined : this._arrGroupDefinition[id];
        }

        async getWitnessGroupsCount() {

            if (!Constants.GROUP_DEFINITION_CONTRACT_ADDRESS) return 0;
            await this._ensureArrGroupDefinition();

            return this._arrGroupDefinition.length;
        }

        async saveBlock(block, blockInfo) {
            const hash = block.hash();

            const buffHash = Buffer.isBuffer(hash) ? hash : Buffer.from(hash, 'hex');

            // save entire block
            // no prefix needed (because we using separate DB)
            const key = createKey('', buffHash);
            if (await this.hasBlock(hash)) {
                throw new Error(`Storage: Block ${buffHash.toString('hex')} already saved!`);
            }
            await this._blockStorage.put(key, block.encode());

            // save blockInfo
            if (!blockInfo) blockInfo = new BlockInfo(block.header);
            await this.saveBlockInfo(blockInfo);
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
            const key = createKey('', bufHash);
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
            const key = createKey('', buffHash);
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
            const blockInfoKey = createKey(BLOCK_INFO_PREFIX, bufHash);

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

            const blockInfoKey = createKey(BLOCK_INFO_PREFIX, Buffer.from(blockInfo.getHash(), 'hex'));
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
         * @returns {Promise<Object>}  keys are txHashes, values - UTXOs
         */
        async getUtxosCreateMap(arrUtxoHashes) {
            const mapUtxos = {};
            for (let coin of arrUtxoHashes) {
                const utxo = await this.getUtxo(coin);
                const strHash = Buffer.isBuffer(coin) ? coin.toString('hex') : coin;
                mapUtxos[strHash] = utxo;
            }

            return mapUtxos;
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
                const bufHash = Buffer.isBuffer(hash) ? hash : Buffer.from(hash, 'hex');
                const key = createKey(UTXO_PREFIX, bufHash);

                const buffUtxo = await this._db.get(key);
                if (!buffUtxo) throw new Error(`Storage: UTXO with hash ${bufHash.toString('hex')} not found !`);

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
                    const key = createKey(UTXO_PREFIX, Buffer.from(strTxHash, 'hex'));
                    if (utxo.isEmpty()) {
                        arrOps.push({type: 'del', key});
                    } else {
                        arrOps.push({type: 'put', key, value: utxo.encode()});
                    }
                }

                // save contracts
                for (let [strContractAddr, contract] of statePatch.getContracts()) {

                    // if we change groupDefinition contract - update cache
                    if (Constants.GROUP_DEFINITION_CONTRACT_ADDRESS === strContractAddr) {
                        this._arrGroupDefinition = contract.getData();
                    }
                    const key = createKey(CONTRACT_PREFIX, Buffer.from(strContractAddr, 'hex'));
                    arrOps.push({type: 'put', key, value: contract.encode()});
                }

                // save contract receipt
                // because we use receipts only for contracts, i decided to keep single txReceipts instead of array of receipts
                //      for whole block
                for (let [strTxHash, receipt] of statePatch.getReceipts()) {
                    const key = createKey(RECEIPT_PREFIX, Buffer.from(strTxHash, 'hex'));
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
                const key = createKey(RECEIPT_PREFIX, Buffer.from(strTxHash, 'hex'));
                const buffData = await this._db.get(key).catch(err => debug(err));
                if (!buffData) return undefined;

                return raw ? buffData : new TxReceipt(buffData);
            });
        }

        /**
         *
         * @param {Buffer} buffAddress
         * @param {Boolean} raw
         * @return {Promise<Contract | Buffer>}
         */
        getContract(buffAddress, raw = false) {
            typeforce(types.Address, buffAddress);

            return this._mutex.runExclusive(['contract'], async () => {

                const key = createKey(CONTRACT_PREFIX, buffAddress);
                const buffData = await this._db.get(key).catch(err => debug(err));
                if (!buffData) return undefined;

                const contract = new Contract(buffData);
                contract.storeAddress(buffAddress);

                return raw ? buffData : contract;
            });
        }

        /**
         * the block hashes up to which the database represents the unspent transaction outputs.
         * @param {Boolean} raw
         * @return {Promise<Array>} of buffers. each is hash of last stable block
         */
        async getLastAppliedBlockHashes(raw = false) {
            const key = createKey(LAST_APPLIED_BLOCKS);
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

            const mapBlockInfo = new Map();
            const key = createKey(LAST_APPLIED_BLOCKS);

            // get previous values.
            const arrFinalBlocks = await this.getLastAppliedBlockHashes();

            // replace old values for getWitnessId with new ones
            const arrConcatedHashes = arrFinalBlocks.concat(arrBlockHashes);
            for (let buffHash of arrConcatedHashes) {
                const blockInfo = await this.getBlockInfo(buffHash);
                mapBlockInfo.set(blockInfo.getWitnessId(), buffHash);
            }

            // serialize and store
            const cArr = new ArrayOfHashes([...mapBlockInfo.values()]);
            await this._db.put(key, cArr.encode());
        }

        /**
         *
         * @param {Boolean} raw
         * @returns {Promise<ArrayOfHashes | Buffer>}
         */
        getPendingBlockHashes(raw = false) {
            const key = createKey(PENDING_BLOCKS);

            return this._mutex.runExclusive(['pending_blocks'], async () => {
                const result = await this._db.get(key).catch(err => debug(err));

                return raw ? result : (Buffer.isBuffer(result) ? (new ArrayOfHashes(result)).getArray() : []);
            });
        }

        updatePendingBlocks(arrBlockHashes) {
            typeforce(typeforce.arrayOf(types.Hash256bit), arrBlockHashes);

            const key = createKey(PENDING_BLOCKS);

            return this._mutex.runExclusive(['pending_blocks'], async () => {
                await this._db.put(key, (new ArrayOfHashes(arrBlockHashes)).encode());
            });
        }

        async getPeer(address) {
            typeforce.oneOf(types.Address, String);

            const strAddress = Buffer.isBuffer(address) ? Transport.addressToString(address) : address;
            const peerInfo = await this._peerStorage.get(strAddress).catch(err => debug(err));
            if (!peerInfo) throw new Error(`Storage: No peer found by address ${strAddress}`);

            return new Peer({peerInfo});
        }

        async savePeer(peer) {
            const peerInfo = peer.peerInfo;
            const key = Buffer.isBuffer(peer.address) ? Transport.addressToString(peer.address) : peer.address;
            peer.saveLifetimeCounters();

            await this._peerStorage.put(key, peerInfo.encode());
        }

        async savePeers(arrPeers) {
            const arrOps = [];

            for (let peer of arrPeers) {
                const peerInfo = peer.peerInfo;
                const key = Buffer.isBuffer(peer.address) ? Transport.addressToString(peer.address) : peer.address;
                peer.saveLifetimeCounters();
                arrOps.push({type: 'put', key, value: peerInfo.encode()});
            }
            await this._peerStorage.batch(arrOps);
        }

        async loadPeers(addresses) {
            let arrPeers = [];
            for (let address of addresses) {
                try {
                    const peer = await this.getPeer(address);
                    arrPeers.push(peer);
                }
                catch(e) {}
            }
            return arrPeers;
        }
        async hasPeer(address) {
            typeforce.oneOf(types.Address, String);

            try {
                await this.getPeer(address);
                return true;
            } catch (e) {
                return false;
            }
        }
    };
};
