const factory = require('../../testFactory');

const HASH_IS_NOT_FOUND = 'Hash is not found';
const HASH_HAS_ALREADY_DEFINED = 'Hash has already defined';
const MUST_BE_MAP_INSTANCE = 'Must be a Map instance';
const UNAUTHORIZED_CALL = 'Unauthorized call';

class Base {
    constructor() {
        this._ownerAddress = callerAddress;
    }

    __getCode() {
        const arrFunctionsToPropagateFromBase = ['_checkOwner', '_transferOwnership', '_validateAddress'];

        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(this))
            .filter(name => name !== 'constructor' && typeof this[name] === 'function')
            .concat(arrFunctionsToPropagateFromBase);
        const objCode = {};
        methods.forEach(strFuncName => {
            const strCodeMethod = this[strFuncName].toString();

            // we prepend code of asynс function with '<'
            const codePrefix = Object.getPrototypeOf(this[strFuncName]).constructor.name === 'AsyncFunction' ? '<' : '';
            const re = new RegExp(`${strFuncName}.*?(\(.*?\).*?\{.*\})`, 'ms');
            const arrMatches = strCodeMethod.match(re);
            if (!arrMatches) throw new Error(`Bad code for ${strFuncName}`);
            objCode[strFuncName] = codePrefix + arrMatches[1];
        });
        return objCode;
    }

    _validateAddress(strAddress) {
        if (strAddress.length !== 40) throw 'Bad address';
    }

    _checkOwner() {
        if (this._ownerAddress !== callerAddress) throw 'Unauthorized call';
    }

    _transferOwnership(strNewAddress) {
        this._checkOwner();
        this._validateAddress(strNewAddress);

        this._ownerAddress = strNewAddress;
    }
}

class UbixNSv1 extends Base {
    constructor() {
        super();
        this._updateFee = 13e4;
        this._data = {};
    }

    resolve(strProvider, strName) {
        this._validateKeyParameters(strProvider, strName);

        const hash = UbixNSv1.getHash(strProvider, strName);
        if (!this._data[hash]) throw new Error(HASH_IS_NOT_FOUND);
        return this._data[hash];
    }

    create(objUnsData) {
        this._validatePermissions();
        this._validateParameters(objUnsData);

        const {strProvider, strName, strIssuerName, strDidAddress} = objUnsData;

        const hash = UbixNSv1.getHash(strProvider, strName);
        if (this._data[hash]) throw new Error(HASH_HAS_ALREADY_DEFINED);

        this._data[hash] = {
            strIssuerName,
            ownerAddress: callerAddress,
            strDidAddress
        };
    }

    remove(objUnsData) {
        this._validatePermissions();

        const {strProvider, strName} = objUnsData;
        this._validateKeyParameters(strProvider, strName);

        const hash = UbixNSv1.getHash(strProvider, strName);
        const record = this._data[hash];

        if (!record) throw new Error(HASH_IS_NOT_FOUND);

        const {ownerAddress} = record;

        // check owner of the record
        if (ownerAddress !== callerAddress) throw new Error(UNAUTHORIZED_CALL);

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
            const {strName} = keyMap.get(key);
            this.remove({strProvider: key, strName});
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

    static getHash(strProvider, strName) {
        return factory.Crypto.createHash(`${strName}.${strProvider}`);
    }

    _validatePermissions() {
        if (!callerAddress) throw new Error('You should sign TX');
        if (value < this._updateFee) throw new Error(`Update fee is ${this._updateFee}`);
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
    Base,
    UbixNSv1
};
