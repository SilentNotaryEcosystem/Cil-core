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

class DidNsV2 extends Base {
    constructor() {
        super();
        this._updateFee = 1000;
        this._ns = {};
        this._dids = {};
    }

    resolve(strProvider, strName) {
        const strDidAddress = this._resolveNs(strProvider, strName);

        return {
            id: `did:ubix:${strDidAddress}`,
            ...this._dids[strDidAddress][2]
        };
    }

    create(objData) {
        this._validatePermissions();
        this._validateObjData(objData, true);

        const strDidAddress = this._md5(JSON.stringify(objData.objDidDocument));
        if (this._dids[strDidAddress]) {
            throw new Error('DID document hash has already defined');
        }

        this._checkForIdKey(objData.objDidDocument);

        this._createBatchNs({...objData, strDidAddress});

        this._dids[strDidAddress] = this._serializeToArray({
            ...objData,
            strOwnerAddress: callerAddress
        });
    }

    remove(strProvider, strName) {
        this._validatePermissions();

        const strDidAddress = this._resolveNs(strProvider, strName);

        const record = this._dids[strDidAddress];
        if (!record) throw new Error('Hash is not found');

        const objData = this._deserializeToObject(record);

        if (callerAddress !== objData.strOwnerAddress) {
            throw new Error('You are not the owner');
        }

        this._removeBatchNs({...objData, strDidAddress});

        delete this._dids[strDidAddress];
    }

    replace(strProvider, strName, objNewData) {
        this._validatePermissions();

        const strDidAddress = this._resolveNs(strProvider, strName);

        this._validateObjData(objNewData, true);

        const record = this._dids[strDidAddress];
        if (!record) {
            throw new Error('Hash is not found');
        }

        const objOldData = this._deserializeToObject(record);

        if (callerAddress !== objOldData.strOwnerAddress) throw 'You are not the owner';

        this._checkForIdKey(objNewData.objDidDocument);

        this._replaceBatchNs({...objOldData, strDidAddress}, {...objNewData, strDidAddress});

        this._dids[strDidAddress] = this._serializeToArray({
            ...objNewData,
            strOwnerAddress: callerAddress
        });
    }

    _getNs() {
        return this._ns;
    }

    _getDids() {
        return this._dids;
    }

    _resolveNs(strProvider, strName) {
        this._validateKeyParameters(strProvider, strName);

        const hash = this._createHash(strProvider, strName);
        if (!hash || !this._ns[hash]) throw new Error('Hash is not found');
        return this._ns[hash][2];
    }

    _createNs(objData) {
        this._validatePermissions();
        this._validateParameters(objData, true);

        const {strProvider, strName, strIssuerName, strDidAddress} = objData;

        const hash = this._createHash(strProvider, strName);

        if (!hash) throw new Error('Not a DID document hash');
        if (this._ns[hash]) throw new Error('Hash has already defined');

        this._ns[hash] = [callerAddress, strIssuerName, strDidAddress];
    }

    _removeNs(objData) {
        this._validatePermissions();
        const {strProvider, strName, strDidAddress} = objData;
        this._validateKeyParameters(strProvider, strName);

        const hash = this._createHash(strProvider, strName);
        if (!hash) throw new Error('Not a DID document hash');

        const record = this._ns[hash];
        if (!record) throw new Error('Hash is not found');

        if (callerAddress !== record[0]) {
            throw Error('You are not the owner');
        }

        if (strDidAddress !== record[2]) {
            throw new Error('Hash belongs to a different address');
        }

        delete this._ns[hash];
    }

    _createBatchNs(objBatchData) {
        this._validateBatchData(objBatchData);
        this._checkKeysAvailability(objBatchData.objDidDocument);

        for (const strProvider in objBatchData.objDidDocument) {
            if (strProvider !== 'id') {
                this._createNs({
                    strProvider,
                    strName: objBatchData.objDidDocument[strProvider],
                    strIssuerName: objBatchData.strIssuerName,
                    strDidAddress: objBatchData.strDidAddress
                });
            }
        }
    }

    _removeBatchNs(objBatchData) {
        this._validateBatchData(objBatchData);
        this._checkKeysAvailability(objBatchData.objDidDocument, false);

        for (const strProvider in objBatchData.objDidDocument) {
            if (strProvider !== 'id') {
                this._removeNs({
                    strProvider,
                    strName: objBatchData.objDidDocument[strProvider],
                    strDidAddress: objBatchData.strDidAddress
                });
            }
        }
    }

    _replaceBatchNs(objOldBatchData, objNewBatchData) {
        this._validateBatchData(objOldBatchData);
        this._validateBatchData(objNewBatchData);

        this._checkKeysAvailability(objOldBatchData.objDidDocument, false);
        this._checkKeysAvailability(objNewBatchData.objDidDocument);

        this._removeBatchNs(objOldBatchData);
        this._createBatchNs(objNewBatchData);
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

    _validateBatchData(objBatchData) {
        if (!(objBatchData instanceof Object)) throw new Error('Must be an Object instance');
        if (!(objBatchData.objDidDocument instanceof Object)) throw new Error('DID document be an Object instance');
    }

    _checkKeysAvailability(objDidDocument, acceptEmpty = true) {
        // тут если ключи и так нам принадлежат их не считать
        for (const strProvider in objDidDocument) {
            if (strProvider !== 'id') {
                const objRecord = this._ns[this._createHash(strProvider, objDidDocument[strProvider])];
                if (acceptEmpty) {
                    if (!objRecord) continue;
                    if (objRecord[0] !== callerAddress) {
                        throw new Error('You are not the owner');
                    }
                } else {
                    if (!objRecord || objRecord[0] !== callerAddress) {
                        throw new Error('You are not the owner');
                    }
                }
            }
        }
    }

    _validateObjData(objData, skipDidAddressCheck = false) {
        if (
            typeof objData !== 'object' ||
            !objData.objDidDocument ||
            typeof objData.objDidDocument !== 'object' ||
            !objData.strIssuerName ||
            typeof objData.strIssuerName !== 'string'
        ) {
            throw new Error('objData has wrong format');
        }

        if (!skipDidAddressCheck) {
            if (!objData.strDidAddress || typeof objData.strDidAddress !== 'string') {
                throw new Error('objData has wrong format');
            }
        }
    }

    _checkForIdKey(objDidDocument) {
        for (const key in objDidDocument) {
            if (key === 'id') {
                throw new Error("Input DID document could not have provider: 'id'");
            }
        }
    }

    _validateDidAddress(strDidAddress) {
        if (typeof strDidAddress !== 'string') throw new Error('strDidAddress should be a string');
    }

    _serializeToArray(objData) {
        return [objData.strOwnerAddress, objData.strIssuerName, Object.entries(objData.objDidDocument)];
    }

    _deserializeToObject(record) {
        return {
            strOwnerAddress: record[0],
            strIssuerName: record[1],
            objDidDocument: record[2].reduce((acc, [key, value]) => ({...acc, [key]: value}), {})
        };
    }

    _createHash(strProvider, strName) {
        if (strProvider !== 'id') {
            return this._md5(`${strName}.${strProvider}`);
        }
        return null;
    }

    _md5(inputString) {
        var hc = '0123456789abcdef';
        function rh(n) {
            var j,
                s = '';
            for (j = 0; j <= 3; j++) s += hc.charAt((n >> (j * 8 + 4)) & 0x0f) + hc.charAt((n >> (j * 8)) & 0x0f);
            return s;
        }
        function ad(x, y) {
            var l = (x & 0xffff) + (y & 0xffff);
            var m = (x >> 16) + (y >> 16) + (l >> 16);
            return (m << 16) | (l & 0xffff);
        }
        function rl(n, c) {
            return (n << c) | (n >>> (32 - c));
        }
        function cm(q, a, b, x, s, t) {
            return ad(rl(ad(ad(a, q), ad(x, t)), s), b);
        }
        function ff(a, b, c, d, x, s, t) {
            return cm((b & c) | (~b & d), a, b, x, s, t);
        }
        function gg(a, b, c, d, x, s, t) {
            return cm((b & d) | (c & ~d), a, b, x, s, t);
        }
        function hh(a, b, c, d, x, s, t) {
            return cm(b ^ c ^ d, a, b, x, s, t);
        }
        function ii(a, b, c, d, x, s, t) {
            return cm(c ^ (b | ~d), a, b, x, s, t);
        }
        function sb(x) {
            var i;
            var nblk = ((x.length + 8) >> 6) + 1;
            var blks = new Array(nblk * 16);
            for (i = 0; i < nblk * 16; i++) blks[i] = 0;
            for (i = 0; i < x.length; i++) blks[i >> 2] |= x.charCodeAt(i) << ((i % 4) * 8);
            blks[i >> 2] |= 0x80 << ((i % 4) * 8);
            blks[nblk * 16 - 2] = x.length * 8;
            return blks;
        }
        var i,
            x = sb(inputString),
            a = 1732584193,
            b = -271733879,
            c = -1732584194,
            d = 271733878,
            olda,
            oldb,
            oldc,
            oldd;
        for (i = 0; i < x.length; i += 16) {
            olda = a;
            oldb = b;
            oldc = c;
            oldd = d;
            a = ff(a, b, c, d, x[i + 0], 7, -680876936);
            d = ff(d, a, b, c, x[i + 1], 12, -389564586);
            c = ff(c, d, a, b, x[i + 2], 17, 606105819);
            b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
            a = ff(a, b, c, d, x[i + 4], 7, -176418897);
            d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
            c = ff(c, d, a, b, x[i + 6], 17, -1473231341);
            b = ff(b, c, d, a, x[i + 7], 22, -45705983);
            a = ff(a, b, c, d, x[i + 8], 7, 1770035416);
            d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
            c = ff(c, d, a, b, x[i + 10], 17, -42063);
            b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
            a = ff(a, b, c, d, x[i + 12], 7, 1804603682);
            d = ff(d, a, b, c, x[i + 13], 12, -40341101);
            c = ff(c, d, a, b, x[i + 14], 17, -1502002290);
            b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
            a = gg(a, b, c, d, x[i + 1], 5, -165796510);
            d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
            c = gg(c, d, a, b, x[i + 11], 14, 643717713);
            b = gg(b, c, d, a, x[i + 0], 20, -373897302);
            a = gg(a, b, c, d, x[i + 5], 5, -701558691);
            d = gg(d, a, b, c, x[i + 10], 9, 38016083);
            c = gg(c, d, a, b, x[i + 15], 14, -660478335);
            b = gg(b, c, d, a, x[i + 4], 20, -405537848);
            a = gg(a, b, c, d, x[i + 9], 5, 568446438);
            d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
            c = gg(c, d, a, b, x[i + 3], 14, -187363961);
            b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
            a = gg(a, b, c, d, x[i + 13], 5, -1444681467);
            d = gg(d, a, b, c, x[i + 2], 9, -51403784);
            c = gg(c, d, a, b, x[i + 7], 14, 1735328473);
            b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
            a = hh(a, b, c, d, x[i + 5], 4, -378558);
            d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
            c = hh(c, d, a, b, x[i + 11], 16, 1839030562);
            b = hh(b, c, d, a, x[i + 14], 23, -35309556);
            a = hh(a, b, c, d, x[i + 1], 4, -1530992060);
            d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
            c = hh(c, d, a, b, x[i + 7], 16, -155497632);
            b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
            a = hh(a, b, c, d, x[i + 13], 4, 681279174);
            d = hh(d, a, b, c, x[i + 0], 11, -358537222);
            c = hh(c, d, a, b, x[i + 3], 16, -722521979);
            b = hh(b, c, d, a, x[i + 6], 23, 76029189);
            a = hh(a, b, c, d, x[i + 9], 4, -640364487);
            d = hh(d, a, b, c, x[i + 12], 11, -421815835);
            c = hh(c, d, a, b, x[i + 15], 16, 530742520);
            b = hh(b, c, d, a, x[i + 2], 23, -995338651);
            a = ii(a, b, c, d, x[i + 0], 6, -198630844);
            d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
            c = ii(c, d, a, b, x[i + 14], 15, -1416354905);
            b = ii(b, c, d, a, x[i + 5], 21, -57434055);
            a = ii(a, b, c, d, x[i + 12], 6, 1700485571);
            d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
            c = ii(c, d, a, b, x[i + 10], 15, -1051523);
            b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
            a = ii(a, b, c, d, x[i + 8], 6, 1873313359);
            d = ii(d, a, b, c, x[i + 15], 10, -30611744);
            c = ii(c, d, a, b, x[i + 6], 15, -1560198380);
            b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
            a = ii(a, b, c, d, x[i + 4], 6, -145523070);
            d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
            c = ii(c, d, a, b, x[i + 2], 15, 718787259);
            b = ii(b, c, d, a, x[i + 9], 21, -343485551);
            a = ad(a, olda);
            b = ad(b, oldb);
            c = ad(c, oldc);
            d = ad(d, oldd);
        }
        return rh(a) + rh(b) + rh(c) + rh(d);
    }
}

module.exports = {
    DidNsV2
};
