const factory = require('../../testFactory');
const getUnsProviderResolver = require('./unsProviderResolver');
const {PROVIDER} = require('./constants');

const HASH_IS_NOT_FOUND = 'Hash is not found!';
const HASH_HAS_ALREADY_DEFINED = 'Hash has already defined!';

class Base {
    constructor() {
        // this._ownerAddress = callerAddress;
    }
}

class Uns extends Base {
    constructor() {
        super();
        this._createFee = 1e10;
        this._hash2address = {}; // move to levelDb
    }

    getUnsProviderResolver(provider) {
        return new (getUnsProviderResolver(provider, this))();
    }

    _add(provider, name, address) {
        const hash = Uns.getNameForHash(provider, name);
        if (this._hash2address[hash]) throw new Error(HASH_HAS_ALREADY_DEFINED);
        this._hash2address[hash] = address;
    }

    _update(hash, address) {
        if (!this._hash2address[hash]) throw new Error(HASH_IS_NOT_FOUND);
        this._hash2address[hash] = address;
    }

    _remove(provider, name) {
        const hash = Uns.getNameForHash(provider, name);
        if (!this._hash2address[hash]) throw new Error(HASH_IS_NOT_FOUND);
        delete this._hash2address[hash];
    }

    _get(provider, name) {
        const hash = Uns.getNameForHash(provider, name);
        const address = this._hash2address[hash];

        return address || null;
    }

    static getNameForHash(provider, name) {
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
}

module.exports = {
    Base,
    Uns
};
