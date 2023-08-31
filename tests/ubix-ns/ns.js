'use strict';

const sha3 = require('js-sha3').sha3_256;

class Base {
    constructor() {
        this._ownerAddress = callerAddress;
    }

    __getCode() {
        const arrFunctionsToPropagateFromBase = [
            '_checkOwner',
            '_transferOwnership',
            '_validateAddress',
            'addManager',
            'removeManager'
        ];

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

    addManager(strManagerAddress) {
        this._validateAddress(strManagerAddress);
        this._checkOwner();

        if (!this._managers) this._managers = [];
        this._managers.push(strManagerAddress);
    }

    removeManager(strManagerAddress) {
        this._validateAddress(strManagerAddress);
        this._checkOwner();

        if (!this._managers) return;
        this._managers = this._managers.filter(strAddr => strAddr !== strManagerAddress);
    }

    _checkManager() {
        if (this._ownerAddress === callerAddress) return;

        if (!this._managers) throw 'Unauthorized call';
        if (!~this._managers.findIndex(strAddr => strAddr === callerAddress)) throw 'Unauthorized call';
    }
}

class Ns extends Base {
    constructor() {
        super();

        // remove everything below for proxy!
        this._updateFee = 130000;
        this._ns = {};
        this._providers = ['email', 'tg', 'ig'];
        this._proxyAddress = undefined;
    }

    getProviders() {
        return this._providers;
    }

    async addProvider(strProvider) {
        // remove for proxy contract!
        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {
                method: 'addProvider',
                arrArguments: [strProvider]
            });
        }

        this._checkOwner();
        if (typeof strProvider !== 'string') throw 'strProvider should be a string';

        const strProviderLower = strProvider.trim().toLowerCase();
        if (this._providers.find(item => item === strProviderLower)) {
            throw 'strProvider already exists';
        }

        this._providers.push(strProviderLower);
    }

    // remove for proxy contract!
    setProxy(strNewAddress) {
        this._checkOwner();
        if (strNewAddress.length !== 40) throw 'Bad address';

        this._proxyAddress = strNewAddress;
    }

    async resolve(strName) {
        // remove for proxy contract!
        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {
                method: 'resolve',
                arrArguments: [strName]
            });
        }

        if (typeof strName !== 'string') throw 'strName should be a string';

        const result = {};
        for (const strProvider of this._providers) {
            const hash = this._calcHash(strProvider, strName);
            const strWalletAddress = this._ns[hash];

            if (strWalletAddress) {
                result[strProvider] = strWalletAddress;
            }
        }

        if (Object.keys(result).length === 0) throw 'Account is not found';

        return result;
    }

    async create(strProvider, strName, strWalletAddress) {
        // remove for proxy contract!
        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {
                method: 'create',
                arrArguments: [strProvider, strName, strWalletAddress]
            });
        }

        this._validatePermissions();
        this._checkOwner();
        this._validateParameters(strProvider, strName);
        this._validateWalletAddress(strWalletAddress);

        const hash = this._calcHash(strProvider, strName);

        if (this._ns[hash]) throw 'Account has already defined';

        this._ns[hash] = strWalletAddress;
    }

    async remove(strProvider, strName) {
        // remove for proxy contract!
        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {
                method: 'remove',
                arrArguments: [strProvider, strName]
            });
        }

        this._validatePermissions();
        this._validateParameters(strProvider, strName);

        const hash = this._calcHash(strProvider, strName);
        const strWalletAddress = this._ns[hash];

        if (!strWalletAddress) throw 'Account is not found';

        if (strWalletAddress !== callerAddress) throw 'You are not the owner';

        delete this._ns[hash];
    }

    _validatePermissions() {
        if (!callerAddress) throw 'You should sign TX';
        if (value < this._updateFee) throw `Update fee is ${this._updateFee}`;
    }

    _validateParameters(strProvider, strName) {
        if (typeof strProvider !== 'string') throw 'strProvider should be a string';
        if (typeof strName !== 'string') throw 'strName should be a string';
        if (!this._providers.includes(strProvider)) throw 'strProvider is not in the providers list';
    }

    _validateWalletAddress(strWalletAddress) {
        if (typeof strWalletAddress !== 'string') throw 'strWalletAddress should be a string';
        this._validateAddress(strWalletAddress);
    }

    _calcHash(strProvider, strName) {
        const strProviderLower = strProvider.trim().toLowerCase();
        const strNameLower = strName.trim().toLowerCase();

        return sha3(`${strProviderLower}:${strNameLower}`);
    }
}

module.exports = {
    Ns
};
