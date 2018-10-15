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
    const {Constants, Block, UTXO} = factory;
    return class Storage {
        constructor(options) {

            // only for tests, for prod we should query DB
            const {arrTestDefinition = []} = options;
            this._groupDefinitions = new Map();
            for (let def of arrTestDefinition) {
                this._groupDefinitions.set(def.getGroupId(), def);
            }

            this._db = new Map();
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
            return new Block(block);
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

        async saveBlock(block) {
            const hash = block.hash();

//            const bufHash = Buffer.isBuffer(hash) ? hash : Buffer.from(hash);
            const strHash = Buffer.isBuffer(hash) ? hash.toString('hex') : hash;
            const key = BLOCK_PREFIX + strHash;
            if (await this.hasBlock(hash)) throw new Error(`Storage: Block ${strHash} already saved!`);

            // TODO: replace to persistent store
            this._db.set(key, block.encode());
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
    };
};
