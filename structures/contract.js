const typeforce = require('typeforce');
const assert = require('assert');

const v8 = require('v8');

const serializeContractData = (objData) => {
    return v8.serialize(objData);
};

const deSerializeContractData = (buffData) => {
    return v8.deserialize(buffData);
};

/**
 * First we serialize data with serializeContractData and thus we have data to be encoded with protobuff
 */

module.exports = (factory, {contractProto}) =>
    class Contract {

        /**
         *
         * @param {Object | Buffer} data
         * @param {String | undefined} strContractAddr
         */
        constructor(data, strContractAddr) {
            typeforce(typeforce.oneOf('Object', 'Buffer'), data);

            if (Buffer.isBuffer(data)) {
                this._data = contractProto.decode(data);
            } else {
                this._data = contractProto.create(data);
            }

            // we'll keep only deserialized data. serialize only for cloning & encode
            if (this._data.contractData && Buffer.isBuffer(this._data.contractData)) {
                this._contractData = deSerializeContractData(this._data.contractData);
            } else {
                this._contractData = data.contractData || {};
            }

            // just to show that we'll not use it after decode
            this._data.contractData = undefined;

            this._strAddress = strContractAddr;
        }

        /**
         * @return {String}
         */
        getCode() {
            return this._data.contractCode;
        }

        getData() {
            return this._contractData;
        }

        getDataBuffer() {
            return serializeContractData(this._contractData);
        }

        getGroupId() {
            return this._data.groupId;
        }

        /**
         *
         * @param {Object | Buffer} data - contract data
         */
        updateData(data) {
            if (Buffer.isBuffer(data)) data = deSerializeContractData(data);

            this._contractData = data;
        }

        /**
         *
         * @return {Buffer}
         */
        encode() {
            assert(this._data.groupId !== undefined, 'Contract "groupId" not specified!');

            this._data.contractData = serializeContractData(this._contractData);
            return contractProto.encode(this._data).finish();
        }

        /**
         *
         * @param {Buffer | String} address
         */
        storeAddress(address) {
            address = Buffer.isBuffer(address) ? address.toString('hex') : address;
            this._strAddress = address;
        }

        /**
         *
         * @return {String}
         */
        getStoredAddress() {
            assert(this._strAddress, 'Contract address not specified!');
            return this._strAddress;
        }

        getBalance() {
            return this._data.balance === undefined ? 0 : this._data.balance;
        }

        deposit(amount) {
            if (typeof this._data.balance !== 'number') {
                this._data.balance = amount;
            } else {
                this._data.balance += amount;
            }
        }

        withdraw(amount) {
            if (typeof this._data.balance !== 'number') throw new Error('Balance uninitialized!');
            if (this._data.balance < amount) throw new Error('Insufficient funds!');

            this._data.balance -= amount;
        }
    };
