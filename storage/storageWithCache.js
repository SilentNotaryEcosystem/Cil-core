'use strict';

module.exports = (PersistentStorage, factory) =>
    class StorageWithCache extends PersistentStorage {
        constructor(options) {
            super(options);
            this._cachedContracts = {
                object: {},
                raw: {}
            };
        }

        /**
         *
         * @param {Buffer | String} address
         * @param {Boolean} raw
         * @return {Promise<Contract | Buffer>}
         */
        async getContract(address, raw = false) {
            const contracts = raw ? this._cachedContracts.raw : this._cachedContracts.object;
            if (contracts[address] !== undefined) {
                return contracts[address];
            }

            const contract = await super.getContract(address, raw);

            if (!contract) return undefined;

            const objContract = raw ? new factory.Contract(contract) : contract;

            if (objContract.getSize() <= factory.Constants.CONTRACT_MIN_CASHING_SIZE) {
                return contract;
            }

            contracts[address] = contract;

            return contract;
        }
    };
