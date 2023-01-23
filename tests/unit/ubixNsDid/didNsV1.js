const HASH_IS_NOT_FOUND = 'Hash is not found';
const HASH_HAS_ALREADY_DEFINED = 'Hash has already defined';
const HASH_HAS_DIFFERENT_ADDRESS = 'Hash belongs to a different address';
const MUST_BE_MAP_INSTANCE = 'Must be a Map instance';
const DID_DOCUMENT_HASH_ALREADY_DEFINED = 'DID document hash has already defined';
const DID_DOCUMENT_DOESNT_HAVE_UNS_KEYS = 'DID document does not have Ubix NS keys';

const DID_PREFIX = 'did:ubix';

const PROVIDER = {
    UBIX: 'ubix',
    TELEGRAM: 'tg',
    INSTAGRAM: 'ig',
    EMAIL: 'email'
};

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
        return createHash(`${strName}.${strProvider}`); // eslint-disable-line
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

class DidV1Test1 extends Base {
    constructor() {
        super();
        this._updateFee = 13e4;
        this._dids = {};
        this._ns = new UbixNSv1Test1();
        this._providers = Object.values(PROVIDER);
    }

    get(strAddress) {
        return {
            id: `${DID_PREFIX}:${strAddress}`,
            ...this._dids[strAddress]
        };
    }

    create(objData) {
        this._validatePermissions();
        const strDidDocument = JSON.stringify(objData.objDidDocument);

        const strDidAddress = createHash(strDidDocument); // eslint-disable-line
        if (this._ns.Data[strDidAddress]) {
            throw new Error(DID_DOCUMENT_HASH_ALREADY_DEFINED);
        }

        const keyMap = this._object2KeyMap({...objData, strDidAddress});

        this._checkForUnsKeys(keyMap);

        this._checkKeysAvailability(keyMap);

        this._ns.createBatch(keyMap);

        this._dids[strDidAddress] = objData.objDidDocument;

        return strDidAddress;
    }

    remove(strDidAddress) {
        const objDidDocument = this._dids[strDidAddress];
        if (!objDidDocument) throw new Error(HASH_IS_NOT_FOUND);

        const keyMap = this._object2KeyMap({objDidDocument, strDidAddress});

        this._checkForUnsKeys(keyMap);

        this._ns.removeBatch(keyMap);

        delete this._dids[strDidAddress];
    }

    replace(strDidAddress, objNewData) {
        const oldDidDocument = this._dids[strDidAddress];
        if (!oldDidDocument) {
            throw new Error(HASH_IS_NOT_FOUND);
        }

        const oldKeyMap = this._object2KeyMap({objDidDocument: oldDidDocument, strDidAddress});

        const keyMap = this._object2KeyMap(objNewData);

        this._checkForUnsKeys(keyMap);

        this._checkKeysAvailability(keyMap);

        this._ns.removeBatch(oldKeyMap);
        this._ns.createBatch(keyMap);

        this._dids[strDidAddress] = objNewData.objDidDocument;
    }

    _object2KeyMap(objData) {
        const keyMap = new Map(
            Object.entries(objData.objDidDocument).map(([strProvider, strName]) => [
                strProvider,
                {
                    strName,
                    strIssuerName: objData.strIssuerName,
                    strDidAddress: objData.strDidAddress
                }
            ])
        );
        return keyMap;
    }

    _checkForUnsKeys(keyMap) {
        let hasKeys = false;

        for (const item of keyMap) {
            if (this._providers.includes(item[0])) {
                hasKeys = true;
                break;
            }
        }

        if (!hasKeys) {
            throw new Error(DID_DOCUMENT_DOESNT_HAVE_UNS_KEYS);
        }

        // if (this._hasUnsKeys(didDocument)) {
        //     throw new Error(UNS_HASH_ALREADY_DEFINED);
        // }
    }

    _checkKeysAvailability(keyMap) {
        // тут если ключи и так нам принадлежат их не считать
        for (const key in keyMap.keys()) {
            if (this._providers.includes(key) && this._ns.Data[DidV1Test1.createHash(key, keyMap[key])]) {
                return true;
            }
        }
        return false;
    }

    static crateHash(provider, name) {
        switch (provider) {
            case PROVIDER.UBIX:
            case PROVIDER.TELEGRAM:
            case PROVIDER.INSTAGRAM:
            case PROVIDER.EMAIL:
                return createHash(`${name}.${provider}`); // eslint-disable-line

            default:
                return null;
        }
    }

    _validatePermissions() {
        if (!callerAddress) throw new Error('You should sign TX');
        if (value < this._updateFee) throw new Error(`Update fee is ${this._updateFee}`);
    }
}

module.exports = {
    UbixNSv1Test1,
    Base,
    DidV1Test1
};

// global.value = 0;
// global.callerAddress = '23423423534534534534534534';
// const contract = new UbixNSv1Test1();

// let objUnsData;

// global.value = 130000;

// objUnsData = {
//     strProvider: 'ubix',
//     strName: 'mytestname',
//     strIssuerName: 'Me',
//     strDidAddress: '0x121212121212'
// };

// // assert.equal(Object.keys(contract._data).length, 0);

// contract.create(objUnsData);

// if (Object.keys(contract._data).length !== 1) throw new Error('AAAAAAAAAAA');

// // assert.equal(Object.keys(contract._data).length, 1);
// // assert.equal(contract.resolve(objUnsData.strProvider, objUnsData.strName).strDidAddress, objUnsData.strDidAddress);
