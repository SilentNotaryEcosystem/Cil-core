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

module.exports = ({Constants}, {contractProto}) =>
    class Contract {

        /**
         *
         * @param {Object | Buffer} data
         * @param {String | undefined} strContractAddr
         * @param {Number | undefined} nContractVersion
         */
        constructor(data, strContractAddr, nContractVersion = Constants.CONTRACT_V_JSON) {
            typeforce(typeforce.oneOf('Object', 'Buffer'), data);

            this._proxiedContract = undefined;

            if (Buffer.isBuffer(data)) {
                this._data = contractProto.decode(data);
            } else {
                if (!data.contractData) data.contractData = {};
                this._cacheData = data.contractData;
                data.contractData = undefined;

                this._cacheCode = typeof data.contractCode === 'string' && data.contractCode.length ?
                    JSON.parse(data.contractCode) : data.contractCode;
                data.contractCode = undefined;

                data.version = nContractVersion;

                const errMsg = contractProto.verify(data);
                if (errMsg) throw new Error(`Contract: ${errMsg}`);

                this._data = contractProto.create(data);
                this._bDataModified = true;
            }

            // deal with LONG https://github.com/dcodeIO/long.js
            // convert it toNumber
            if (Long.isLong(this._data.balance)) this._data.balance = this._data.balance.toNumber();

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
            if (this._cacheCode) return this._cacheCode;
            this._cacheCode = this._data.contractCode ? JSON.parse(this._data.contractCode) : undefined;
            return this._cacheCode;
        }

        getData() {
            if (this._cacheData) return this._cacheData;
            this._cacheData = this._deserialize();
            return this._cacheData;
        }

        getDataBuffer() {
            if (!this.isDataModified() && this._data.contractData && this._data.contractData.length) {
                return this._data.contractData;
            }
            if (this._cacheData) return this._serialize(this._cacheData);

            throw ('Unexpected situation');
        }

        getConciliumId() {
            return this._data.hasOwnProperty('conciliumId') ? this._data.conciliumId : undefined;
        }

        setConciliumId(nConciliumId) {
            this._data.conciliumId = nConciliumId;
        }

        getDataSize() {
            this._ensureData();
            const nDataSize = this._data.contractData.length;

            const result = nDataSize - this.getSizeOfEmptyData();
            return result > 0 ? result : 0;
        }

        /**
         * It used in 2 places, so i see no reason to duplicate it
         * Invalidate stored data
         *
         * @param {Object} data - contract data
         */
        updateData(data) {
            this._bDataModified = true;
            if (!Buffer.isBuffer(data)) {
                this._cacheData = data;
                this._invalidateEncodedData();
            } else {
                throw('Unexpected update with buffer data');
            }
        }

        /**
         * Data will be encoded only if invalid and cache is good
         *
         * @return {Buffer}
         */
        encode() {
            assert(this._data.conciliumId !== undefined, 'Contract "conciliumId" not specified!');

            this._ensureData();

            if (!this._data.hasOwnProperty('contractCode') && this._cacheCode) {
                this._data.contractCode = JSON.stringify(this._cacheCode);
            }

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

        setVersion(nVersion) {
            this._data.version = nVersion;
        }

        switchSerializerToJson() {
            this.getData();
            this.setVersion(Constants.CONTRACT_V_JSON);
            this._invalidateEncodedData();
        }

        switchSerializerToOld() {
            this.getData();
            this.setVersion(Constants.CONTRACT_V_V8);
            this._invalidateEncodedData();
        }

        /**
         * this is related to this issue https://github.com/nodejs/help/issues/2448
         * i realized it on HEIGHT_FORK_SERIALIZER block
         * quick (but not good fixed it)
         *
         * So this function should help to process old blocks until we finally move to JSON serializer
         *
         */
        dirtyWorkaround() {
            if (!this._bPatched && this.getVersion() !== Constants.CONTRACT_V_JSON && !this.isDataModified()) return;

            this.getData();
            this.setVersion(Constants.CONTRACT_V_V8);

            const buffData = serializeContractDataV8(this._cacheData);
            const objData = deSerializeContractDataV8(buffData);

            this._data.contractData = serializeContractDataV8(objData);
            delete this._cacheData;

            this._bPatched = true;
        }

        getSizeOfEmptyData() {
            if (this.getVersion() === Constants.CONTRACT_V_JSON) {
                return nSizeOfEmptyDataJson;
            } else {
                return nSizeOfEmptyDataV8;
            }
        }

        _serialize(objData) {
            if (this.getVersion() === Constants.CONTRACT_V_JSON) return serializeContractDataJson(objData);
            return serializeContractDataV8(objData);
        }

        _deserialize() {
            if (this.getVersion() === Constants.CONTRACT_V_JSON) {
                return deSerializeContractDataJson(
                    this._data.contractData);
            }
            return deSerializeContractDataV8(this._data.contractData);
        }

        _ensureData() {
            if (!this._data.hasOwnProperty('contractData') && this._cacheData) {
                this._data.contractData = this._serialize(this._cacheData);
            }
        }

        _invalidateEncodedData() {
            delete this._data.contractData;
        }

        /**
         * Data was updated or object was created from Object
         * @return {boolean}
         */
        isDataModified() {
            return !!this._bDataModified;
        }
    };
