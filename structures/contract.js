// part of protobuff
const Long = require('long');
const typeforce = require('typeforce');
const assert = require('assert');

const v8 = require('v8');

const serializeContractData = (objData) => {
    return v8.serialize(objData);
};

const deSerializeContractData = (buffData) => {
    return v8.deserialize(buffData);
};

const nSizeOfEmptyData = serializeContractData({}).length;

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

            this._proxiedContract = undefined;

            if (Buffer.isBuffer(data)) {
                this._data = contractProto.decode(data);
            } else {
                if (typeof data.contractData === 'object') data.contractData = serializeContractData(data.contractData);
                if (typeof data.contractCode === 'object') data.contractCode = JSON.stringify(data.contractData);
                const errMsg = contractProto.verify(data);
                if (errMsg) throw new Error(`Contract: ${errMsg}`);

                this._data = contractProto.create(data);
            }

            // we'll keep only deserialized data. serialize only for cloning & encode
            if (this._data.contractData && Buffer.isBuffer(this._data.contractData)) {
                this.updateData(this._data.contractData);
            } else {
                this._dataSize = nSizeOfEmptyData;
                this._contractData = data.contractData || {};
            }

            // deal with LONG https://github.com/dcodeIO/long.js
            // convert it toNumber
            if (Long.isLong(this._data.balance)) this._data.balance = this._data.balance.toNumber();

            // just to show that we'll not use it after decode
            this._data.contractData = undefined;

            this._strAddress = strContractAddr;
        }

        /**
         *
         * @param {Object} data - raw data of this class
         * @returns {this}
         */
        static createFromData(data) {
            data.__proto__ = this.prototype;
            return data;
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

        getConciliumId() {
            return this._data.conciliumId;
        }

        setConciliumId(nConciliumId) {
            this._data.conciliumId = nConciliumId;
        }

        getDataSize() {
            const result = this._dataSize - nSizeOfEmptyData;
            return result > 0 ? result : 0;
        }

        /**
         *
         * @param {Object | Buffer} data - contract data
         */
        updateData(data) {
            if (Buffer.isBuffer(data)) {
                this._dataSize = data.length;
                data = deSerializeContractData(data);
            } else {
                this._dataSize = serializeContractData(data).length;
            }

            this._contractData = data;
        }

        /**
         *
         * @return {Buffer}
         */
        encode() {
            assert(this._data.conciliumId !== undefined, 'Contract "conciliumId" not specified!');

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

        /**
         *
         * @returns {number|*}
         */
        getBalance() {
            return this._proxiedContract ? this._proxiedContract.getBalance() : this._data.balance;
        }

        deposit(amount) {
            typeforce('Number', amount);

            if (this._proxiedContract) {
                this._proxiedContract.deposit(amount);
            } else {
                this._data.balance += amount;
            }
        }

        withdraw(amount) {
            if (this.getBalance() < amount) throw new Error('Insufficient funds!');
            this.deposit(0 - amount);
        }

        clone() {
            return new Contract(this.encode(), this._strAddress);
        }

        /**
         * Now we proxy only balances!
         * Data not used
         *
         * @param contract
         */
        proxyContract(contract) {
            this._proxiedContract = contract;
        }
    };
