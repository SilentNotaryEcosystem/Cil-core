const factory = require('../../testFactory');

const HASH_IS_NOT_FOUND = 'Hash is not found';
const HASH_HAS_ALREADY_DEFINED = 'Hash has already defined';
const HASH_HAS_DIFFERENT_ADDRESS = 'Hash belongs to a different address';
const MUST_BE_MAP_INSTANCE = 'Must be a Map instance';

class UbixNSv1Test1 {
    constructor() {
        this._data = {};
    }

    get Data() {
        return this._data;
    }

    resolve(strProvider, strName) {
        this._validateKeyParameters(strProvider, strName);

        const hash = UbixNSv1Test1.createHash(strProvider, strName);
        if (!this._data[hash]) throw new Error(HASH_IS_NOT_FOUND);
        return this._data[hash];
    }

    create(objUnsData) {
        this._validateParameters(objUnsData);

        const {strProvider, strName, strIssuerName, strDidAddress} = objUnsData;

        const hash = UbixNSv1Test1.createHash(strProvider, strName);
        if (this._data[hash]) throw new Error(HASH_HAS_ALREADY_DEFINED);

        this._data[hash] = {
            strIssuerName,
            strDidAddress
        };
    }

    remove(objUnsData) {
        const {strProvider, strName, strDidAddress} = objUnsData;
        this._validateKeyParameters(strProvider, strName);

        const hash = UbixNSv1Test1.createHash(strProvider, strName);
        const record = this._data[hash];

        if (!record) throw new Error(HASH_IS_NOT_FOUND);

        if (strDidAddress !== record.strDidAddress) {
            throw new Error(HASH_HAS_DIFFERENT_ADDRESS);
        }

        delete this._data[hash];
    }

    createBatch(keyMap) {
        this._validateKeyMap(keyMap);

        const keys = keyMap.keys();
        for (const key of keys) {
            const {strName, strIssuerName, strDidAddress} = keyMap.get(key);

            this.create({strProvider: key, strName, strIssuerName, strDidAddress});
        }
    }

    removeBatch(keyMap) {
        this._validateKeyMap(keyMap);

        const keys = keyMap.keys();
        for (const key of keys) {
            const {strName, strDidAddress} = keyMap.get(key);
            this.remove({strProvider: key, strName, strDidAddress});
        }
    }

    hasKeys(keyMap) {
        this._validateKeyMap(keyMap);

        // if we have strAddress, then skip own keys
        const keys = keyMap.keys();
        for (const key of keys) {
            const {strName, strDidAddress} = keyMap.get(key);
            const strUnsAddress = this.resolve(key, strName);
            if ((!strDidAddress && strUnsAddress) || (strUnsAddress && strDidAddress !== strUnsAddress)) {
                return true;
            }
        }
        return false;
    }

    static createHash(strProvider, strName) {
        return factory.Crypto.createHash(`${strName}.${strProvider}`);
    }

    _validateKeyParameters(strProvider, strName) {
        if (typeof strProvider !== 'string') throw new Error('strProvider should be a string');
        if (typeof strName !== 'string') throw new Error('strName should be a string');
    }

    _validateParameters({strProvider, strName, strIssuerName, strDidAddress}, checkAddress = true) {
        this._validateKeyParameters(strProvider, strName);
        if (typeof strIssuerName !== 'string') throw Error('strIssuerName should be a string');
        if (checkAddress && typeof strDidAddress !== 'string') throw new Error('strDidAddress should be a string');
    }

    _validateKeyMap(keyMap) {
        if (!(keyMap instanceof Map)) throw new Error(MUST_BE_MAP_INSTANCE);
    }
}

module.exports = {
    UbixNSv1Test1
};
