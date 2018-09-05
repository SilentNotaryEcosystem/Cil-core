const debugLib = require('debug');
const {sleep} = require('../utils');

const debug = debugLib('storage:');

module.exports = (factory) => {
    const {Constants} = factory;
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
    }
}
