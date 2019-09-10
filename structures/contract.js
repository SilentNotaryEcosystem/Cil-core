// part of protobuff
const Long = require('long');
const typeforce = require('typeforce');
const assert = require('assert');

// v8.serialize undeterministic in encoded data length, so we couldn't use it to calculate storage fee!
const v8 = require('v8');
const serializeContractDataV8 = (objData) => {
    return v8.serialize(objData);
};
const deSerializeContractDataV8 = (buffData) => {
    return v8.deserialize(buffData);
};
const nSizeOfEmptyDataV8 = serializeContractDataV8({}).length;

// so we temporary replace with JSON.stringify
const serializeContractDataJson = (objData) => {
    return Buffer.from(JSON.stringify(objData));
};
const deSerializeContractDataJson = (buffData) => {
    return JSON.parse(buffData.toString());
};
const nSizeOfEmptyDataJson = serializeContractDataJson({}).length;

const V_JSON = 2;

module.exports = (factory, {contractProto}) =>
    class Contract {

        /**
         *
         * @param {Object | Buffer} data
         * @param {String | undefined} strContractAddr
         */
        constructor(data, strContractAddr) {
            typeforce(typeforce.oneOf('Object', 'Buffer'), data);

            this.defaultSerializer();

            this._proxiedContract = undefined;

            if (Buffer.isBuffer(data)) {
                this._data = contractProto.decode(data);
            } else {
                if (typeof data.contractData === 'object') {
                    data.contractData =
                        this._fnSerializer(data.contractData);
                }
                if (typeof data.contractCode === 'object') data.contractCode = JSON.stringify(data.contractCode);
                const errMsg = contractProto.verify(data);
                if (errMsg) throw new Error(`Contract: ${errMsg}`);

                this._data = contractProto.create(data);
            }

            // we'll keep only deserialized data. serialize only for cloning & encode
            if (this._data.contractData && Buffer.isBuffer(this._data.contractData)) {
                this.updateData(this._data.contractData);
            } else {
                this._dataSize = this._nSizeOfEmptyData;
                this._contractData = {};
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
            data.defaultSerializer();
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
            return this._fnSerializer(this._contractData);
        }

        getConciliumId() {
            return this._data.conciliumId;
        }

        setConciliumId(nConciliumId) {
            this._data.conciliumId = nConciliumId;
        }

        getDataSize() {
            if (this._dataSize === undefined) this._dataSize = this._fnSerializer(this._contractData).length;

            const result = this._dataSize - this._nSizeOfEmptyData;
            return result > 0 ? result : 0;
        }

        /**
         *
         * @param {Object | Buffer} data - contract data
         */
        updateData(data) {
            if (Buffer.isBuffer(data)) {
                this._dataSize = data.length;

                if (this.getVersion() === V_JSON) {
                    data = deSerializeContractDataJson(data);
                } else {
                    data = deSerializeContractDataV8(data);
                }
            } else {
                this._dataSize = this._fnSerializer(data).length;
            }

            this._contractData = Object.assign({}, data);
        }

        /**
         *
         * @return {Buffer}
         */
        encode() {
            assert(this._data.conciliumId !== undefined, 'Contract "conciliumId" not specified!');

            // undefined for default scenario
            this._data.version = this._nVersion;
            this._data.contractData = this._fnSerializer(this._contractData);

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

        getVersion() {
            return this._data.version;
        }

        switchSerializerToJson() {
            this._fnSerializer = serializeContractDataJson;
            this._nSizeOfEmptyData = nSizeOfEmptyDataJson;
            this._nVersion = V_JSON;

            this._dataSize = this._fnSerializer(this._contractData).length;
        }

        defaultSerializer() {
            this._fnSerializer = serializeContractDataV8;
            this._nSizeOfEmptyData = nSizeOfEmptyDataV8;
            this._nVersion = undefined;
        }
    };
