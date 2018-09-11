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
            typeforce(typeforce.Hash256bit, blockHash);

            let strHash = Buffer.isBuffer(blockHash) ? blockHash.toString('hex') : blockHash;

            // TODO: implement query DB for hash
            return false;
        }

        async getBlock(blockHash) {
            typeforce(typeforce.Hash256bit, blockHash);

            let strHash = Buffer.isBuffer(blockHash) ? blockHash.toString('hex') : blockHash;

            // TODO: implement query DB for hash
            return new Block();
        }
    }
}
