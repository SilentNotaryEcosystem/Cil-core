'use strict';

const typeforce = require('typeforce');
const debugLib = require('debug');

const {sleep} = require('../utils');
const types = require('../types');

const debug = debugLib('storage:');

// TODO: use mutex to get|put|patch records !!!

const UTXO_PREFIX = 'c';
const BLOCK_PREFIX = 'b';
const BLOCK_INFO_PREFIX = 'H';
const LAST_APPLIED_BLOCKS = 'FINAL';

module.exports = (factory) => {
    const {Constants, Block, BlockInfo, UTXO} = factory;
    return class Storage {
        constructor(options) {

            // only for tests, for prod we should query DB
            const {arrTestDefinition = []} = options;
            this._groupDefinitions = new Map();
            for (let def of arrTestDefinition) {
                this._groupDefinitions.set(def.getGroupId(), def);
            }

            this._db = new Map();

            // possibly it's a good idea to keep blocks separately from UTXO DB
            // it will allow erase UTXO DB, and rebuild it from block DB
            // it could be levelDB also, but in different dir
            this._blockStorage = new Map();
        }

        /**
         *
         * @param {Buffer | String} publicKey
         * @returns {Promise<Array>} of WitnessGroupDefinition this publicKey belongs to
         */
        async getWitnessGroupsByKey(publicKey) {
            const buffPubKey = Buffer.isBuffer(publicKey) ? publicKey : Buffer.from(publicKey, 'hex');

            // TODO: read from DB
            const arrResult = [];
            for (let def of this._groupDefinitions.values()) {
                if (~def.getPublicKeys().findIndex(key => key.equals(buffPubKey))) arrResult.push(def);
            }
            return arrResult;
        }

        /**
         *
         * @param {Number} id
         * @returns {Promise<WitnessGroupDefinition>} of groupDefinition publicKey belongs to
         */
        async getWitnessGroupById(id) {

            // TODO: implement persistent storage
            return this._groupDefinitions.get(id);
        }

        async getWitnessGroupsCount() {

            // TODO: implement persistent storage
            return this._groupDefinitions.size;
        }

        async saveBlock(block) {
            const hash = block.hash();

//            const bufHash = Buffer.isBuffer(hash) ? hash : Buffer.from(hash);
            const strHash = Buffer.isBuffer(hash) ? hash.toString('hex') : hash;

            // save entire block
            const key = BLOCK_PREFIX + strHash;
            if (await this.hasBlock(hash)) throw new Error(`Storage: Block ${strHash} already saved!`);
            this._blockStorage.set(key, block.encode());

            // save blockInfo
            await this.saveBlockInfo(strHash, new BlockInfo(block.header));
        }

        /**
         * Do we have that block? We'll check BlockInfo storage (not block)!
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
         * Return entire block!
         *
         * @param {String | Buffer} blockHash
         * @return {Promise<Block>}
         */
        async getBlock(blockHash) {
            typeforce(types.Hash256bit, blockHash);

//            const bufHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash);
            const strHash = Buffer.isBuffer(blockHash) ? blockHash.toString('hex') : blockHash;

            const key = BLOCK_PREFIX + strHash;
            const block = this._blockStorage.get(key);
            if (!block) throw new Error(`Storage: No block found by hash ${strHash}`);
            return new Block(block);
        }

        /**
         * Get BlockInfo @see proto/structures.proto
         *
         * @param {String | Buffer} blockHash
         * @return {Promise<BlockInfo>}
         */
        async getBlockInfo(blockHash) {
            typeforce(types.Hash256bit, blockHash);

//            const bufHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash);
            const strHash = Buffer.isBuffer(blockHash) ? blockHash.toString('hex') : blockHash;

            const blockInfoKey = BLOCK_INFO_PREFIX + strHash;
            const buffInfo = this._db.get(blockInfoKey);
            if (!buffInfo) throw new Error(`Storage: No block found by hash ${strHash}`);
            return new BlockInfo(buffInfo);
        }

        /**
         * Get BlockInfo @see proto/structures.proto

         * @param {String | Buffer} blockHash
         * @param {BlockInfo} blockInfo
         */
        async saveBlockInfo(blockHash, blockInfo) {
            typeforce(types.Hash256bit, blockHash);

//            const bufHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash);
            const strHash = Buffer.isBuffer(blockHash) ? blockHash.toString('hex') : blockHash;

            const blockInfoKey = BLOCK_INFO_PREFIX + strHash;
            this._db.set(blockInfoKey, blockInfo.encode());
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

        async getUtxo(hash) {
            typeforce(types.Hash256bit, hash);

//            const bufHash = Buffer.isBuffer(hash) ? hash : Buffer.from(hash);
            const strHash = Buffer.isBuffer(hash) ? hash.toString('hex') : hash;
            const key = UTXO_PREFIX + strHash;

            // TODO: implement persistent storage
            const utxo = this._db.get(key);
            if (!utxo) throw new Error(`Storage: UTXO with hash ${strHash} not found!`);

            return new UTXO({txHash: hash, data: utxo});
        }

        /**
         *
         * @param {PatchDB} statePatch
         * @returns {Promise<void>}
         */
        async applyPatch(statePatch) {

            // TODO: implement creating/modification of definitions (groups|templates)
            // TODO: add mutex here!
            for (let [txHash, utxo] of statePatch.getCoins()) {
                const strHash = Buffer.isBuffer(txHash) ? txHash.toString('hex') : txHash;
                const key = UTXO_PREFIX + strHash;
                if (utxo.isEmpty()) {
                    this._db.delete(key);
                } else {
                    this._db.set(key, utxo.encode());
                }
            }
        }

        /**
         * the block hashes up to which the database represents the unspent transaction outputs.
         *
         * @return {Promise<Array>} of buffers. each is hash of last stable block
         */
        async getLastAppliedBlocks() {

            // TODO: storage of array in levelDB not so simple. i think we need serialization
            const result = this._db.get(LAST_APPLIED_BLOCKS);
            return Array.isArray(result) ? result : [];
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
            const arrFinalBlocks = await this.getLastAppliedBlocks();

            // Get ALL BlockInfos. First for current LAST_APPLIED_BLOCKS, then for replacement
            const arrConcatedHashes = arrFinalBlocks.concat(arrBlockHashes);
            for (let buffHash of arrConcatedHashes) {
                const blockInfo = await this.getBlockInfo(buffHash);
                mapBlockInfo.set(blockInfo.getWitnessId(), buffHash);
            }

            // TODO: storage of array in levelDB not so simple. i think we need serialization
            this._db.set(LAST_APPLIED_BLOCKS, [...mapBlockInfo.values()]);
        }
    };
};
