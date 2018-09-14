'use strict';

const typeforce = require('typeforce');
const debugLib = require('debug');

const {sleep} = require('../utils');
const types = require('../types');

const debug = debugLib('storage:');

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

            // TODO: implement query DB for hash. keys are buffers
            return !!this._db.get(strHash);
        }

        async getBlock(blockHash) {
            typeforce(types.Hash256bit, blockHash);

//            const bufHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash);
            const strHash = Buffer.isBuffer(blockHash) ? blockHash.toString('hex') : blockHash;

            // TODO: implement query DB for hash. keys are buffers
            const block = this._db.get(strHash);
            if (!block) throw new Error(`Storage: No block found by hash ${strTxHash}`);
            return block;
        }

        async getUtxo(hash) {
            typeforce(typeforce.Hash256bit, hash);

            const bufHash = Buffer.isBuffer(blockHash) ? blockHash : Buffer.from(blockHash);

            // TODO: implement query DB for hash. keys are buffers
            return {};
        }

        async saveBlock(block) {
            const strHash = block.hash();

            if (await this.hasBlock(strHash)) throw new Error(`Storage: Block ${strHash} already saved!`);

            // TODO: replace to persistent store
            this._db.set(block.hash(), block);
        }

        /**
         *
         * @param {Patch} statePatch
         * @returns {Promise<void>}
         */
        async applyPatch(statePatch) {

            // TODO: spend coins, create new coins (utxo), change definitions (groups|templates)
        }
    }
}
