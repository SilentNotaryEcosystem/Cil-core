'use strict';

const elliptic = require('elliptic');
const sha3 = require('js-sha3');

const ec = new elliptic.ec('secp256k1');

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
    constructor(strPublicKey) {
        super();

        // remove everything below for proxy!
        this._validatePublicKey(strPublicKey);

        this._updateFee = 130000;
        this._ns = {};
        this._providers = ['email', 'tg', 'ig'];
        this._proxyAddress = undefined;

        this._publicKey = strPublicKey;
    }

    setPublicKey(strKey) {
        this._checkOwner();
        this._validatePublicKey(strKey);
        this._publicKey = strKey;
    }

    getPublicKey() {
        return this._publicKey;
    }

    getProviders() {
        return this._providers;
    }

    addProvider(strProvider) {
        this._checkOwner();
        if (typeof strProvider !== 'string') throw new Error('strProvider should be a string');

        const strProviderLower = strProvider.trim().toLowerCase();
        if (this._providers.find(item => item === strProviderLower)) {
            throw new Error('strProvider already exists');
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

        if (typeof strName !== 'string') throw new Error('strName should be a string');

        const strNameLower = strName.trim().toLowerCase();

        const result = {};
        for (const strProvider of this._providers) {
            const hash = this._sha256(`${strProvider}:${strNameLower}`);
            const record = this._ns[hash];

            if (record) {
                result[strProvider] = `Ux${record[0]}`;
            }
        }

        if (Object.keys(result).length === 0) throw new Error('Hash is not found');

        return result;
    }

    async create(strProvider, strName, strAddress, strVerificationCode) {
        // remove for proxy contract!
        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {
                method: 'create',
                arrArguments: [strProvider, strName, strAddress, strVerificationCode]
            });
        }

        this._validatePermissions();
        this._validatePublicKey(this._publicKey);
        this._validateCreateParameters(strProvider, strName, strAddress, strVerificationCode);

        const strProviderLower = strProvider.trim().toLowerCase();
        const strNameLower = strName.trim().toLowerCase();
        const strAddressLower = strAddress.trim().toLowerCase().replace(/^ux/, '');

        const hash = this._sha256(`${strProviderLower}:${strNameLower}`);

        if (this._ns[hash]) throw 'Hash has already defined';

        const strToSign = `${strProviderLower}:${strNameLower}:${strAddressLower}`;

        let bResult = false;

        try {
            bResult = ec.verify(
                strToSign,
                JSON.parse(Buffer.from(strVerificationCode, 'base64').toString('binary')),
                this._publicKey,
                'hex'
            );
        } catch (e) {
            throw 'Not valid verification code or public key';
        }

        if (!bResult) {
            throw 'Not valid verification code';
        }

        this._ns[hash] = [strAddressLower, callerAddress];
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

        const hash = this._sha256(`${strProvider}:${strName}`);
        const record = this._ns[hash];

        if (!record || record.length === 0) throw new Error('Hash is not found');
        if (record[1] !== callerAddress) throw new Error('You are not the owner');

        delete this._ns[hash];
    }

    async getVeficationCode(strProvider, strName) {
        this._checkOwner();
        // remove for proxy contract!
        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {
                method: 'getVeficationCode',
                arrArguments: [strProvider, strName]
            });
        }

        this._validatePermissions();
        this._validateParameters(strProvider, strName);

        const hash = this._sha256(`${strProvider}:${strName}`);

        return JSON.stringify(ec.sign(hash, this._privateKey, 'hex'));
    }

    // TODO: Remove for release
    _getNs() {
        // this._checkOwner();
        return this._ns;
    }

    _validatePermissions() {
        if (!callerAddress) throw new Error('You should sign TX');
        if (value < this._updateFee) throw new Error(`Update fee is ${this._updateFee}`);
    }

    _validateParameters(strProvider, strName) {
        if (typeof strProvider !== 'string') throw new Error('strProvider should be a string');
        if (typeof strName !== 'string') throw new Error('strName should be a string');
        if (!this._providers.includes(strProvider)) throw new Error('strProvider is not in the providers list');
    }

    _validateCreateParameters(strProvider, strName, strAddress, strVerificationCode) {
        this._validateParameters(strProvider, strName);
        if (typeof strAddress !== 'string') throw new Error('strAddress should be a string');
        if (typeof strVerificationCode !== 'string') throw new Error('strVerificationCode should be a string');
    }

    _validatePublicKey(strPublicKey) {
        if (typeof strPublicKey !== 'string') throw new Error('Contract should have valid public key');
    }

    _sha256(strInput) {
        return sha3.sha3_256(strInput);
    }
}

module.exports = {
    Ns
};
