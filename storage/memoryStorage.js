'use strict';

const typeforce = require('typeforce');
const debugLib = require('debug');

const types = require('../types');

const debug = debugLib('storage:');

// TODO: use mutex to get|put|patch records !!!

const UTXO_PREFIX = 'c';
const BLOCK_PREFIX = 'b';
const BLOCK_INFO_PREFIX = 'H';
const CONTRACT_PREFIX = 'S';
const RECEIPT_PREFIX = 'R';
const LAST_APPLIED_BLOCKS = 'FINAL';
const PENDING_BLOCKS = 'PENDING';

module.exports = (factory) => {
    const {Constants, Block, BlockInfo, UTXO, ArrayOfHashes, Contract, TxReceipt} = factory;
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

        async saveBlock(block, blockInfo) {
            const hash = block.hash();

//            const bufHash = Buffer.isBuffer(hash) ? hash : Buffer.from(hash);
            const strHash = Buffer.isBuffer(hash) ? hash.toString('hex') : hash;

            // save entire block
            const key = BLOCK_PREFIX + strHash;
            if (await this.hasBlock(hash)) throw new Error(`Storage: Block ${strHash} already saved!`);
            this._blockStorage.set(key, block.encode());

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

//            const bufHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash);
            const strHash = Buffer.isBuffer(blockHash) ? blockHash.toString('hex') : blockHash;

            const key = BLOCK_PREFIX + strHash;
            await this._blockStorage.delete(key);
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

//            const bufHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash);
            const strHash = Buffer.isBuffer(blockHash) ? blockHash.toString('hex') : blockHash;

            const key = BLOCK_PREFIX + strHash;
            const buffBlock = this._blockStorage.get(key);
            if (!buffBlock) throw new Error(`Storage: No block found by hash ${strHash}`);
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

//            const bufHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash);
            const strHash = Buffer.isBuffer(blockHash) ? blockHash.toString('hex') : blockHash;

            const blockInfoKey = BLOCK_INFO_PREFIX + strHash;
            const buffInfo = this._db.get(blockInfoKey);
            if (!buffInfo) throw new Error(`Storage: No block found by hash ${strHash}`);
            return raw ? buffInfo : new BlockInfo(buffInfo);
        }

        /**
         * Get BlockInfo @see proto/structures.proto

         * @param {BlockInfo} blockInfo
         */
        async saveBlockInfo(blockInfo) {
            typeforce(types.BlockInfo, blockInfo);

            const blockHash = blockInfo.getHash();
//            const bufHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash);
            const strHash = Buffer.isBuffer(blockHash) ? blockHash.toString('hex') : blockHash;

            const blockInfoKey = BLOCK_INFO_PREFIX + strHash;
            this._db.set(blockInfoKey, blockInfo.encode());
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
         * @returns {Promise<*>}
         */
        async getUtxo(hash, raw = false) {
            typeforce(types.Hash256bit, hash);

//            const bufHash = Buffer.isBuffer(hash) ? hash : Buffer.from(hash);
            const strHash = Buffer.isBuffer(hash) ? hash.toString('hex') : hash;
            const key = UTXO_PREFIX + strHash;

            // TODO: implement persistent storage
            const buffUtxo = this._db.get(key);
            if (!buffUtxo) throw new Error(`Storage: UTXO with hash ${strHash} not found!`);

            return raw ? buffUtxo : new UTXO({txHash: hash, data: buffUtxo});
        }

        /**
         *
         * @param {PatchDB} statePatch
         * @returns {Promise<void>}
         */
        async applyPatch(statePatch) {

            // TODO: implement creating/modification of definitions (groups|templates)
            // TODO: add mutex here!
            // TODO use binary keys for UTXO & Contracts
            for (let [txHash, utxo] of statePatch.getCoins()) {
                const strHash = Buffer.isBuffer(txHash) ? txHash.toString('hex') : txHash;
                const key = UTXO_PREFIX + strHash;
                if (utxo.isEmpty()) {
                    this._db.delete(key);
                } else {
                    this._db.set(key, utxo.encode());
                }
            }

            // save contracts
            for (let [contractAddr, contract] of statePatch.getContracts()) {
                const key = CONTRACT_PREFIX + contractAddr;
                this._db.set(key, contract.encode());
            }

            // save contract receipt
            // because we use receipts only for contracts, i decided to keep single txReceipts instead of array of receipts
            //      for whole block
            for (let [txHash, receipt] of statePatch.getReceipts()) {
                const key = RECEIPT_PREFIX + txHash;
                this._db.set(key, receipt.encode());
            }
        }

        /**
         *
         * @param {String} strTxHash
         * @param {Boolean} raw
         * @returns {Promise<any>}
         */
        async getTxReceipt(strTxHash, raw) {
            const key = RECEIPT_PREFIX + strTxHash;
            const buffData = this._db.get(key);
            return raw ? buffData : new TxReceipt(buffData);
        }

        /**
         *
         * @param {Buffer} buffAddress
         * @param {Boolean} raw
         * @return {Promise<Contract | Buffer>}
         */
        async getContract(buffAddress, raw = false) {
            typeforce(types.Address, buffAddress);

            const key = CONTRACT_PREFIX + buffAddress.toString('hex');
            const buffData = this._db.get(key);
            if (!buffData) return undefined;
            const contract = new Contract(buffData);
            contract.storeAddress(buffAddress);

            return raw ? buffData : contract;
        }

        /**
         * the block hashes up to which the database represents the unspent transaction outputs.
         * @param {Boolean} raw
         * @return {Promise<Array>} of buffers. each is hash of last stable block
         */
        async getLastAppliedBlockHashes(raw = false) {

            const result = this._db.get(LAST_APPLIED_BLOCKS);
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
            this._db.set(LAST_APPLIED_BLOCKS, cArr.encode());
        }

        /**
         *
         * @param {Boolean} raw
         * @returns {Promise<*>}
         */
        async getPendingBlockHashes(raw = false) {

            const result = this._db.get(PENDING_BLOCKS);
            return raw ? result : (Buffer.isBuffer(result) ? (new ArrayOfHashes(result)).getArray() : []);
        }

        async updatePendingBlocks(arrBlockHashes) {
            typeforce(typeforce.arrayOf(types.Hash256bit), arrBlockHashes);

            this._db.set(PENDING_BLOCKS, (new ArrayOfHashes(arrBlockHashes)).encode());
        }
    };
};
