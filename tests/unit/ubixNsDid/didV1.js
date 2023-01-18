const factory = require('../../testFactory');
const {UbixNSv1Test1: NS} = require('./nsV1');
const {PROVIDER} = require('./constants');

const HASH_IS_NOT_FOUND = 'Hash is not found';
const DID_DOCUMENT_HASH_ALREADY_DEFINED = 'DID document hash has already defined';
const DID_DOCUMENT_DOESNT_HAVE_UNS_KEYS = 'DID document does not have Ubix NS keys';

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
        this._ns = new NS();
        this._providers = Object.values(PROVIDER);
    }

    get(strAddress) {
        return this._dids[strAddress];
    }

    create(objData) {
        this._validatePermissions();
        const strDidDocument = JSON.stringify(objData.objDidDocument);

        const strDidAddress = factory.Crypto.createHash(strDidDocument);
        if (this._ns.Data[strDidAddress]) {
            throw new Error(DID_DOCUMENT_HASH_ALREADY_DEFINED);
        }

        const keyMap = this._object2KeyMap({...objData, strDidAddress});

        this._checkForUnsKeys(keyMap);

        this._checkKeysAvailability(keyMap);

        this._ns.createBatch(keyMap);

        this._dids[strDidAddress] = objData.objDidDocument;
    }

    remove(strDidAddress) {
        const objDidDocument = this._dids[strDidAddress];
        if (!objDidDocument) throw new Error(HASH_IS_NOT_FOUND);

        const keyMap = this._object2KeyMap(objDidDocument);

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
            if (this._providers.includes(key) && this._ns.Data[DidV1.createHash(key, keyMap[key])]) {
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
                return factory.Crypto.createHash(`${name}.${provider}`);

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
    Base,
    DidV1Test1
};
