const factory = require('../../testFactory');

const {Base, Uns} = require('./uns');
const {ADDRESS_TYPE, DID_PREFIX, PROVIDER} = require('./constants');

const HASH_IS_NOT_FOUND = 'Hash is not found!';
const DID_DOCUMENT_HASH_ALREADY_DEFINED = 'DID document hash has already defined!';
const DID_DOCUMENT_DOESNT_HAVE_UNS_KEYS = 'DID document does not have UNS keys';
const UNS_HASH_ALREADY_DEFINED = 'Ubix NS hash has already defined!';

class Did extends Base {
    constructor() {
        super();
        this._uns = new Uns();
        this._didDocuments = {};
        this._providers = Object.values(PROVIDER);
    }

    get Uns() {
        return this._uns;
    }

    create(objDidDocument) {
        if (!this._hasDocumentUnsKeys(objDidDocument)) {
            throw new Error(DID_DOCUMENT_DOESNT_HAVE_UNS_KEYS);
        }

        const strAddress = Did._getHash(objDidDocument);
        if (this._didDocuments[strAddress]) {
            throw new Error(DID_DOCUMENT_HASH_ALREADY_DEFINED);
        }

        if (this._uns.hasKeys(objDidDocument)) {
            throw new Error(UNS_HASH_ALREADY_DEFINED);
        }

        this._didDocuments[strAddress] = objDidDocument;

        this._uns.createBatch(objDidDocument, strAddress);

        return strAddress;
    }

    replace(strAddress, objNewDidDocument) {
        const objOldDidDocument = this._didDocuments[strAddress];
        if (!objOldDidDocument) {
            throw new Error(HASH_IS_NOT_FOUND);
        }

        if (!this._hasDocumentUnsKeys(objNewDidDocument)) {
            throw new Error(DID_DOCUMENT_DOESNT_HAVE_UNS_KEYS);
        }

        if (this._uns.hasKeys(objNewDidDocument, strAddress)) {
            throw new Error(UNS_HASH_ALREADY_DEFINED);
        }

        this._didDocuments[strAddress] = objNewDidDocument;

        this._uns.removeBatch(objOldDidDocument);
        this._uns.createBatch(objNewDidDocument, strAddress);
    }

    remove(strAddress) {
        const objDidDocument = this._didDocuments[strAddress];
        if (!objDidDocument) throw new Error(HASH_IS_NOT_FOUND);

        this._uns.removeBatch(objDidDocument);

        delete this._didDocuments[strAddress];
    }

    get(strAddress) {
        return this._didDocuments[strAddress] || null;
    }

    getData(strAddress, addressType = null) {
        if (!strAddress) return null;

        switch (addressType) {
            case ADDRESS_TYPE.DID_ID:
                return Did._getDid(strAddress);
            case ADDRESS_TYPE.DID_DOCUMENT:
                return this.get(strAddress);
            default:
                return strAddress;
        }
    }

    static _getDid(strAddress) {
        return `${DID_PREFIX}:${strAddress}`;
    }

    static _getHash(objDidDocument) {
        return factory.Crypto.createHash(JSON.stringify(objDidDocument));
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

module.exports = {Did};
