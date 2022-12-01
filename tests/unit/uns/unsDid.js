const factory = require('../../testFactory');
const getUnsDidResolver = require('./unsDidResolver');

const {Uns} = require('./uns');
const {ADDRESS_TYPE, DID_PREFIX} = require('./constants');

// const ADDRESS_IS_NOT_FOUND = 'Address is not found!';
const ADDRESS_HAS_ALREADY_DEFINED = 'Address has already defined!';

class UnsDid extends Uns {
    constructor() {
        super();
        this._didDocument = {}; // move to levelDb
    }

    getUnsDidResolver() {
        return getUnsDidResolver(this);
    }

    static get DID_PREFIX() {
        return DID_PREFIX;
    }

    _get(provider, name, addresType) {
        const hash = Uns.getNameForHash(provider, name);
        const address = this._hash2address[hash];

        if (!address) return null;

        switch (addresType) {
            case ADDRESS_TYPE.DID_ID:
                return UnsDid._getDid(address);
            case ADDRESS_TYPE.DID_DOCUMENT:
                return this._getDidDocument(address);
            default:
                return address;
        }
    }

    _addDidDocument(address, objDocument) {
        const addressHash = UnsDid.getNameForHash(address);
        if (this._didDocument[addressHash]) throw new Error(ADDRESS_HAS_ALREADY_DEFINED);
        this._didDocument[addressHash] = objDocument;
    }

    _getDidDocument(address) {
        const addressHash = UnsDid.getNameForHash(address);
        const objDocument = this._didDocument[addressHash];

        return objDocument || null;
    }

    static _getDid(address) {
        return `${DID_PREFIX}:${address}`;
    }

    static _getAddressHash(address) {
        return factory.Crypto.createHash(address);
    }
}

module.exports = {UnsDid};
