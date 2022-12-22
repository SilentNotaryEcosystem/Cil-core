const factory = require('../../testFactory');
const {PROVIDER} = require('./constants');

const HASH_IS_NOT_FOUND = 'Hash is not found!';
const HASH_HAS_ALREADY_DEFINED = 'Hash has already defined!';
const DID_DOCUMENT_DOESNT_HAVE_UNS_KEYS = 'DID document does not have UNS keys';

class Base {
    constructor() {
        this._ownerAddress = callerAddress;
    }
}

class Uns extends Base {
    constructor() {
        super();
        this._createFee = 1e10;
        this._hash2address = {};
        this._providers = Object.values(PROVIDER);
    }

    get(strProvider, strName) {
        const hash = Uns.getHash(strProvider, strName);
        return this._hash2address[hash] || null;
    }

    create(strProvider, strName, strAddress) {
        const hash = Uns.getHash(strProvider, strName);
        if (this._hash2address[hash]) throw new Error(HASH_HAS_ALREADY_DEFINED);
        this._hash2address[hash] = strAddress;
    }

    remove(strProvider, strName) {
        const hash = Uns.getHash(strProvider, strName);
        if (!this._hash2address[hash]) throw new Error(HASH_IS_NOT_FOUND);
        delete this._hash2address[hash];
    }

    createBatch(objDidDocument, strAddress) {
        if (!this._hasDocumentUnsKeys(objDidDocument)) {
            throw new Error(DID_DOCUMENT_DOESNT_HAVE_UNS_KEYS);
        }

        for (const key in objDidDocument) {
            if (this._providers.includes(key)) {
                this.create(key, objDidDocument[key], strAddress);
            }
        }
    }

    removeBatch(objDidDocument) {
        if (!this._hasDocumentUnsKeys(objDidDocument)) {
            throw new Error(DID_DOCUMENT_DOESNT_HAVE_UNS_KEYS);
        }

        for (const key in objDidDocument) {
            if (this._providers.includes(key)) {
                this.remove(key, objDidDocument[key]);
            }
        }
    }

    hasKeys(objDidDocument, strAddress = null) {
        // if we have strAddress, then skip own keys
        for (const key in objDidDocument) {
            if (this._providers.includes(key)) {
                const strUnsAddress = this.get(key, objDidDocument[key]);
                if ((!strAddress && strUnsAddress) || (strUnsAddress && strAddress !== strUnsAddress)) {
                    return true;
                }
            }
        }
        return false;
    }

    static getHash(strProvider, strName) {
        switch (strProvider) {
            case PROVIDER.UBIX:
            case PROVIDER.TELEGRAM:
            case PROVIDER.INSTAGRAM:
            case PROVIDER.EMAIL:
                return factory.Crypto.createHash(`${strName}.${strProvider}`);

            default:
                return null;
        }
    }

    _hasDocumentUnsKeys(objDidDocument) {
        for (const key in objDidDocument) {
            if (this._providers.includes(key)) {
                return true;
            }
        }
        return false;
    }
}

module.exports = {
    Base,
    Uns
};
