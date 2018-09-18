'use strict';

const typeforce = require('typeforce');
const debugLib = require('debug');

const {sleep} = require('../utils');
const types = require('../types');

const debug = debugLib('storage:');

// TODO: use mutex to get|put|patch records !!!

const UTXO_PREFIX = 'c';
const BLOCK_PREFIX = 'B';

module.exports = (factory) => {
    const {Constants, Block} = factory;
    return class Storage {
        constructor(options) {

            const {arrTestDefinition = []} = options;
            this._groupDefinitions = new Map(arrTestDefinition);
            this._db = new Map();
        }

        /**
         *
         * @return {Promise<*>} Map witnessGroupName -> Array of public keys
         */
        async getGroupDefinitions() {

            // TODO: read from DB
            return this._groupDefinitions;
        }

        async hasBlock(blockHash) {
            typeforce(types.Hash256bit, blockHash);

//            const bufHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash);
            const strHash = Buffer.isBuffer(blockHash) ? blockHash.toString('hex') : blockHash;

            const key = BLOCK_PREFIX + strHash;
            return !!this._db.get(key);
        }

        async getBlock(blockHash) {
            typeforce(types.Hash256bit, blockHash);

//            const bufHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash);
            const strHash = Buffer.isBuffer(blockHash) ? blockHash.toString('hex') : blockHash;

            const key = BLOCK_PREFIX + strHash;
            const block = this._db.get(key);
            if (!block) throw new Error(`Storage: No block found by hash ${strHash}`);
            return block;
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

            const utxo = this._db.get(key);
            if (!utxo) throw new Error(`Storage: UTXO with hash ${strHash} not found!`);

            return utxo;
        }

        async saveBlock(block) {
            const hash = block.hash();

//            const bufHash = Buffer.isBuffer(hash) ? hash : Buffer.from(hash);
            const strHash = Buffer.isBuffer(hash) ? hash.toString('hex') : hash;
            const key = BLOCK_PREFIX + strHash;
            if (await this.hasBlock(hash)) throw new Error(`Storage: Block ${strHash} already saved!`);

            // TODO: replace to persistent store
            this._db.set(key, block);
        }

        /**
         *
         * @param {PatchDB} statePatch
         * @returns {Promise<void>}
         */
        async applyPatch(statePatch) {

            // TODO: implement definitions (groups|templates)
            // TODO: add mutex here!
            for (let [txHash, utxo] of statePatch.getCoinsToAdd().entries()) {
                const strHash = Buffer.isBuffer(txHash) ? txHash.toString('hex') : txHash;
                const key = UTXO_PREFIX + strHash;
                this._db.set(key, utxo);
            }

            for (let [txHash, utxo] of statePatch.getCoinsToRemove()) {
                const strHash = Buffer.isBuffer(txHash) ? txHash.toString('hex') : txHash;
                const key = UTXO_PREFIX + strHash;
                this._db.set(key, utxo);
            }
        }
    };
};
