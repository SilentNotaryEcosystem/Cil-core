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
        this._contracts = [];
        this._strCurrentContract = null;
    }

    getCurrentContract() {
        return this._strCurrentContract;
    }

    _setCurrentContract(strContractAddress) {
        this._checkOwner();
        this._strCurrentContract = strContractAddress;
    }

    _addActiveContract(strContractAddress) {
        this._checkOwner();
        this._contracts.push(strContractAddress);
    }

    getActiveContract() {
        return this._contracts.length === 0 ? null : this._contracts[this._contracts.length - 1];
    }

    _cleanActiveContracts() {
        this._checkOwner();
        this._contracts = [];
    }

    _listActiveContracts() {
        // this._checkOwner();
        return this._contracts;
    }

    _isProxy() {
        // if _isProxy() === true, contract is locked for read/write
        return this._contracts.length !== 0 && this._contracts[this._contracts.length - 1] !== this._strContractAddress;
    }

    async resolve(strProvider, strName) {
        if (!this._isProxy()) {
            return this._resolveLocal(strProvider, strName);
        } else {
            return await call(this._contracts[this._contracts.length - 1], {
                method: 'resolve',
                arrArguments: [strProvider, strName]
            });
        }
    }

    async get(strDidAddress) {
        if (!this._isProxy()) {
            return this._getLocal(strDidAddress);
        } else {
            return await call(this._contracts[this._contracts.length - 1], {
                method: 'get',
                arrArguments: [strDidAddress]
            });
        }
    }

    _resolveLocal(strProvider, strName) {
        const strDidAddress = this._resolveNs(strProvider, strName);
        return this._getLocal(strDidAddress);
    }

    _getLocal(strDidAddress) {
        if (!strDidAddress || !this._dids[strDidAddress]) throw new Error('Address is not found');
        return {
            ...this._deserializeToDid(this._dids[strDidAddress][2]),
            id: `did:ubix:${strDidAddress}`
        };
    }

    async create(objData) {
        if (!this._isProxy()) {
            this._validatePermissions();
            this._validateObjData(objData, true);

            const strDidAddress = this._sha256(JSON.stringify(objData.objDidDocument));
            if (this._dids[strDidAddress]) {
                throw new Error('DID document hash has already defined');
            }

            this._checkForIdKey(objData.objDidDocument);

            global.bIndirectCall = true;
            this._createBatchNs({...objData, strDidAddress});

            this._dids[strDidAddress] = this._serializeToArray({
                ...objData,
                strOwnerAddress: callerAddress
            });
        } else {
            return await call(this._contracts[this._contracts.length - 1], {
                method: 'create',
                arrArguments: [objData]
            });
        }
    }

    async remove(strProvider, strName) {
        if (!this._isProxy()) {
            this._validatePermissions();

            const strDidAddress = this._resolveNs(strProvider, strName);

            const record = this._dids[strDidAddress];
            if (!record) throw new Error('Hash is not found');

            const objData = this._deserializeToObject(record);

            // the contract owner could delete every record
            if (callerAddress !== objData.strOwnerAddress || callerAddress !== this._ownerAddress) {
                throw new Error('You are not the owner');
            }

            global.bIndirectCall = true;
            this._removeBatchNs({...objData, strDidAddress});

            delete this._dids[strDidAddress];
        } else {
            return await call(this._contracts[this._contracts.length - 1], {
                method: 'remove',
                arrArguments: [strProvider, strName]
            });
        }
    }

    async replace(strProvider, strName, objNewData) {
        if (!this._isProxy()) {
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

            global.bIndirectCall = true;
            this._replaceBatchNs({...objOldData, strDidAddress}, {...objNewData, strDidAddress});

            this._dids[strDidAddress] = this._serializeToArray({
                ...objNewData,
                strOwnerAddress: callerAddress
            });
        } else {
            return await call(this._contracts[this._contracts.length - 1], {
                method: 'replace',
                arrArguments: [strProvider, strName, objNewData]
            });
        }
    }

    _getNs() {
        // this._checkOwner();
        return this._ns;
    }

    _getNsCount() {
        // this._checkOwner();
        return Object.keys(this._ns).length;
    }

    _getDids() {
        // this._checkOwner();
        return this._dids;
    }

    _getDidsCount() {
        // this._checkOwner();
        return Object.keys(this._dids).length;
    }

    _download(nPage, nCountOnPage = 20) {
        // this._checkOwner();
        const arrNsKeys = Object.keys(this._ns).sort((a, b) => (a !== b ? (a < b ? -1 : 1) : 0));
        const arrPageKeys = arrNsKeys.slice(nPage * nCountOnPage, (nPage + 1) * nCountOnPage);

        let result = {};
        for (let i = 0; i < arrPageKeys.length; i++) {
            result = {
                ...result,
                [arrPageKeys[i]]: {
                    ns: this._ns[arrPageKeys[i]],
                    did: this._dids[this._ns[arrPageKeys[i]]]
                }
            };
        }
        return result;
    }

    _upload(objData) {
        // this._checkOwner();
        for (const key in objData) {
            this._ns[key] = objData[key].ns;
            this._dids[objData[key].ns] = objData[key].did;
        }
    }

    _resolveNs(strProvider, strName) {
        this._validateKeyParameters(strProvider, strName);

        const hash = this._createHash(strProvider, strName);
        if (!hash || !this._ns[hash]) throw new Error('Hash is not found');
        return this._ns[hash];
    }

    _createNs(objData) {
        if (!global.bIndirectCall) throw "You aren't supposed to be here";

        this._validatePermissions();
        this._validateParameters(objData, true);

        const {strProvider, strName, strDidAddress} = objData;

        const hash = this._createHash(strProvider, strName);

        if (!hash) throw new Error('Not a DID document hash');
        if (this._ns[hash]) throw new Error('Hash has already defined');

        this._ns[hash] = strDidAddress;
    }

    _removeNs(objData) {
        if (!global.bIndirectCall) throw "You aren't supposed to be here";

        this._validatePermissions();
        const {strProvider, strName, strDidAddress} = objData;
        this._validateKeyParameters(strProvider, strName);

        const hash = this._createHash(strProvider, strName);
        if (!hash) throw new Error('Not a DID document hash');

        const record = this._ns[hash];
        if (!record) throw new Error('Hash is not found');

        if (strDidAddress !== record) {
            throw new Error('Hash belongs to a different address');
        }

        delete this._ns[hash];
    }

    _createBatchNs(objBatchData) {
        if (!global.bIndirectCall) throw "You aren't supposed to be here";

        this._validateBatchData(objBatchData);

        for (const strProvider in objBatchData.objDidDocument) {
            if (strProvider !== 'id') {
                this._createNs({
                    strProvider,
                    strName: objBatchData.objDidDocument[strProvider],
                    strDidAddress: objBatchData.strDidAddress
                });
            }
        }
    }

    _removeBatchNs(objBatchData) {
        if (!global.bIndirectCall) throw "You aren't supposed to be here";

        this._validateBatchData(objBatchData);

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
        if (!global.bIndirectCall) throw "You aren't supposed to be here";

        this._validateBatchData(objOldBatchData);
        this._validateBatchData(objNewBatchData);

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

    _validateParameters({strProvider, strName, strDidAddress}, checkAddress = true) {
        this._validateKeyParameters(strProvider, strName);
        if (checkAddress && typeof strDidAddress !== 'string') throw new Error('strDidAddress should be a string');
    }

    _validateBatchData(objBatchData) {
        if (!(objBatchData instanceof Object)) throw new Error('Must be an Object instance');
        if (!(objBatchData.objDidDocument instanceof Object)) throw new Error('DID document be an Object instance');
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
            objDidDocument: this._deserializeToDid(record[2])
        };
    }

    _deserializeToDid(arrData) {
        return arrData.reduce((acc, [key, value]) => ({...acc, [key]: value}), {});
    }

    _createHash(strProvider, strName) {
        if (strProvider !== 'id') {
            return this._sha256(`${strName}.${strProvider}`);
        }
        return null;
    }

    /**
     * [js-sha3]{@link https://github.com/emn178/js-sha3}
     *
     * @version 0.8.0
     * @author Chen, Yi-Cyuan [emn178@gmail.com]
     * @copyright Chen, Yi-Cyuan 2015-2018
     * @license MIT
     */
    _sha256(strInput) {
        var INPUT_ERROR = 'input is invalid type';
        var FINALIZE_ERROR = 'finalize already called';
        var root = {};
        var ARRAY_BUFFER = !root.JS_SHA3_NO_ARRAY_BUFFER && typeof ArrayBuffer !== 'undefined';
        var HEX_CHARS = '0123456789abcdef'.split('');
        var SHAKE_PADDING = [31, 7936, 2031616, 520093696];
        var CSHAKE_PADDING = [4, 1024, 262144, 67108864];
        var KECCAK_PADDING = [1, 256, 65536, 16777216];
        var PADDING = [6, 1536, 393216, 100663296];
        var SHIFT = [0, 8, 16, 24];
        var RC = [
            1, 0, 32898, 0, 32906, 2147483648, 2147516416, 2147483648, 32907, 0, 2147483649, 0, 2147516545, 2147483648,
            32777, 2147483648, 138, 0, 136, 0, 2147516425, 0, 2147483658, 0, 2147516555, 0, 139, 2147483648, 32905,
            2147483648, 32771, 2147483648, 32770, 2147483648, 128, 2147483648, 32778, 0, 2147483658, 2147483648,
            2147516545, 2147483648, 32896, 2147483648, 2147483649, 0, 2147516424, 2147483648
        ];
        var BITS = [224, 256, 384, 512];
        var SHAKE_BITS = [128, 256];
        var OUTPUT_TYPES = ['hex', 'buffer', 'arrayBuffer', 'array', 'digest'];
        var CSHAKE_BYTEPAD = {
            128: 168,
            256: 136
        };

        if (root.JS_SHA3_NO_NODE_JS || !Array.isArray) {
            Array.isArray = function (obj) {
                return Object.prototype.toString.call(obj) === '[object Array]';
            };
        }

        if (ARRAY_BUFFER && (root.JS_SHA3_NO_ARRAY_BUFFER_IS_VIEW || !ArrayBuffer.isView)) {
            ArrayBuffer.isView = function (obj) {
                return typeof obj === 'object' && obj.buffer && obj.buffer.constructor === ArrayBuffer;
            };
        }

        var createOutputMethod = function (bits, padding, outputType) {
            return function (message) {
                return new Keccak(bits, padding, bits).update(message)[outputType]();
            };
        };

        var createShakeOutputMethod = function (bits, padding, outputType) {
            return function (message, outputBits) {
                return new Keccak(bits, padding, outputBits).update(message)[outputType]();
            };
        };

        var createCshakeOutputMethod = function (bits, padding, outputType) {
            return function (message, outputBits, n, s) {
                return methods['cshake' + bits].update(message, outputBits, n, s)[outputType]();
            };
        };

        var createKmacOutputMethod = function (bits, padding, outputType) {
            return function (key, message, outputBits, s) {
                return methods['kmac' + bits].update(key, message, outputBits, s)[outputType]();
            };
        };

        var createOutputMethods = function (method, createMethod, bits, padding) {
            for (var i = 0; i < OUTPUT_TYPES.length; ++i) {
                var type = OUTPUT_TYPES[i];
                method[type] = createMethod(bits, padding, type);
            }
            return method;
        };

        var createMethod = function (bits, padding) {
            var method = createOutputMethod(bits, padding, 'hex');
            method.create = function () {
                return new Keccak(bits, padding, bits);
            };
            method.update = function (message) {
                return method.create().update(message);
            };
            return createOutputMethods(method, createOutputMethod, bits, padding);
        };

        var createShakeMethod = function (bits, padding) {
            var method = createShakeOutputMethod(bits, padding, 'hex');
            method.create = function (outputBits) {
                return new Keccak(bits, padding, outputBits);
            };
            method.update = function (message, outputBits) {
                return method.create(outputBits).update(message);
            };
            return createOutputMethods(method, createShakeOutputMethod, bits, padding);
        };

        var createCshakeMethod = function (bits, padding) {
            var w = CSHAKE_BYTEPAD[bits];
            var method = createCshakeOutputMethod(bits, padding, 'hex');
            method.create = function (outputBits, n, s) {
                if (!n && !s) {
                    return methods['shake' + bits].create(outputBits);
                } else {
                    return new Keccak(bits, padding, outputBits).bytepad([n, s], w);
                }
            };
            method.update = function (message, outputBits, n, s) {
                return method.create(outputBits, n, s).update(message);
            };
            return createOutputMethods(method, createCshakeOutputMethod, bits, padding);
        };

        var createKmacMethod = function (bits, padding) {
            var w = CSHAKE_BYTEPAD[bits];
            var method = createKmacOutputMethod(bits, padding, 'hex');
            method.create = function (key, outputBits, s) {
                return new Kmac(bits, padding, outputBits).bytepad(['KMAC', s], w).bytepad([key], w);
            };
            method.update = function (key, message, outputBits, s) {
                return method.create(key, outputBits, s).update(message);
            };
            return createOutputMethods(method, createKmacOutputMethod, bits, padding);
        };

        var algorithms = [
            {name: 'keccak', padding: KECCAK_PADDING, bits: BITS, createMethod: createMethod},
            {name: 'sha3', padding: PADDING, bits: BITS, createMethod: createMethod},
            {name: 'shake', padding: SHAKE_PADDING, bits: SHAKE_BITS, createMethod: createShakeMethod},
            {name: 'cshake', padding: CSHAKE_PADDING, bits: SHAKE_BITS, createMethod: createCshakeMethod},
            {name: 'kmac', padding: CSHAKE_PADDING, bits: SHAKE_BITS, createMethod: createKmacMethod}
        ];

        var methods = {},
            methodNames = [];

        for (var i = 0; i < algorithms.length; ++i) {
            var algorithm = algorithms[i];
            var bits = algorithm.bits;
            for (var j = 0; j < bits.length; ++j) {
                var methodName = algorithm.name + '_' + bits[j];
                methodNames.push(methodName);
                methods[methodName] = algorithm.createMethod(bits[j], algorithm.padding);
                if (algorithm.name !== 'sha3') {
                    var newMethodName = algorithm.name + bits[j];
                    methodNames.push(newMethodName);
                    methods[newMethodName] = methods[methodName];
                }
            }
        }

        function Keccak(bits, padding, outputBits) {
            this.blocks = [];
            this.s = [];
            this.padding = padding;
            this.outputBits = outputBits;
            this.reset = true;
            this.finalized = false;
            this.block = 0;
            this.start = 0;
            this.blockCount = (1600 - (bits << 1)) >> 5;
            this.byteCount = this.blockCount << 2;
            this.outputBlocks = outputBits >> 5;
            this.extraBytes = (outputBits & 31) >> 3;

            for (var i = 0; i < 50; ++i) {
                this.s[i] = 0;
            }
        }

        Keccak.prototype.update = function (message) {
            if (this.finalized) {
                throw new Error(FINALIZE_ERROR);
            }
            var notString,
                type = typeof message;
            if (type !== 'string') {
                if (type === 'object') {
                    if (message === null) {
                        throw new Error(INPUT_ERROR);
                    } else if (ARRAY_BUFFER && message.constructor === ArrayBuffer) {
                        message = new Uint8Array(message);
                    } else if (!Array.isArray(message)) {
                        if (!ARRAY_BUFFER || !ArrayBuffer.isView(message)) {
                            throw new Error(INPUT_ERROR);
                        }
                    }
                } else {
                    throw new Error(INPUT_ERROR);
                }
                notString = true;
            }
            var blocks = this.blocks,
                byteCount = this.byteCount,
                length = message.length,
                blockCount = this.blockCount,
                index = 0,
                s = this.s,
                i,
                code;

            while (index < length) {
                if (this.reset) {
                    this.reset = false;
                    blocks[0] = this.block;
                    for (i = 1; i < blockCount + 1; ++i) {
                        blocks[i] = 0;
                    }
                }
                if (notString) {
                    for (i = this.start; index < length && i < byteCount; ++index) {
                        blocks[i >> 2] |= message[index] << SHIFT[i++ & 3];
                    }
                } else {
                    for (i = this.start; index < length && i < byteCount; ++index) {
                        code = message.charCodeAt(index);
                        if (code < 0x80) {
                            blocks[i >> 2] |= code << SHIFT[i++ & 3];
                        } else if (code < 0x800) {
                            blocks[i >> 2] |= (0xc0 | (code >> 6)) << SHIFT[i++ & 3];
                            blocks[i >> 2] |= (0x80 | (code & 0x3f)) << SHIFT[i++ & 3];
                        } else if (code < 0xd800 || code >= 0xe000) {
                            blocks[i >> 2] |= (0xe0 | (code >> 12)) << SHIFT[i++ & 3];
                            blocks[i >> 2] |= (0x80 | ((code >> 6) & 0x3f)) << SHIFT[i++ & 3];
                            blocks[i >> 2] |= (0x80 | (code & 0x3f)) << SHIFT[i++ & 3];
                        } else {
                            code = 0x10000 + (((code & 0x3ff) << 10) | (message.charCodeAt(++index) & 0x3ff));
                            blocks[i >> 2] |= (0xf0 | (code >> 18)) << SHIFT[i++ & 3];
                            blocks[i >> 2] |= (0x80 | ((code >> 12) & 0x3f)) << SHIFT[i++ & 3];
                            blocks[i >> 2] |= (0x80 | ((code >> 6) & 0x3f)) << SHIFT[i++ & 3];
                            blocks[i >> 2] |= (0x80 | (code & 0x3f)) << SHIFT[i++ & 3];
                        }
                    }
                }
                this.lastByteIndex = i;
                if (i >= byteCount) {
                    this.start = i - byteCount;
                    this.block = blocks[blockCount];
                    for (i = 0; i < blockCount; ++i) {
                        s[i] ^= blocks[i];
                    }
                    f(s);
                    this.reset = true;
                } else {
                    this.start = i;
                }
            }
            return this;
        };

        Keccak.prototype.encode = function (x, right) {
            var o = x & 255,
                n = 1;
            var bytes = [o];
            x = x >> 8;
            o = x & 255;
            while (o > 0) {
                bytes.unshift(o);
                x = x >> 8;
                o = x & 255;
                ++n;
            }
            if (right) {
                bytes.push(n);
            } else {
                bytes.unshift(n);
            }
            this.update(bytes);
            return bytes.length;
        };

        Keccak.prototype.encodeString = function (str) {
            var notString,
                type = typeof str;
            if (type !== 'string') {
                if (type === 'object') {
                    if (str === null) {
                        throw new Error(INPUT_ERROR);
                    } else if (ARRAY_BUFFER && str.constructor === ArrayBuffer) {
                        str = new Uint8Array(str);
                    } else if (!Array.isArray(str)) {
                        if (!ARRAY_BUFFER || !ArrayBuffer.isView(str)) {
                            throw new Error(INPUT_ERROR);
                        }
                    }
                } else {
                    throw new Error(INPUT_ERROR);
                }
                notString = true;
            }
            var bytes = 0,
                length = str.length;
            if (notString) {
                bytes = length;
            } else {
                for (var i = 0; i < str.length; ++i) {
                    var code = str.charCodeAt(i);
                    if (code < 0x80) {
                        bytes += 1;
                    } else if (code < 0x800) {
                        bytes += 2;
                    } else if (code < 0xd800 || code >= 0xe000) {
                        bytes += 3;
                    } else {
                        code = 0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(++i) & 0x3ff));
                        bytes += 4;
                    }
                }
            }
            bytes += this.encode(bytes * 8);
            this.update(str);
            return bytes;
        };

        Keccak.prototype.bytepad = function (strs, w) {
            var bytes = this.encode(w);
            for (var i = 0; i < strs.length; ++i) {
                bytes += this.encodeString(strs[i]);
            }
            var paddingBytes = w - (bytes % w);
            var zeros = [];
            zeros.length = paddingBytes;
            this.update(zeros);
            return this;
        };

        Keccak.prototype.finalize = function () {
            if (this.finalized) {
                return;
            }
            this.finalized = true;
            var blocks = this.blocks,
                i = this.lastByteIndex,
                blockCount = this.blockCount,
                s = this.s;
            blocks[i >> 2] |= this.padding[i & 3];
            if (this.lastByteIndex === this.byteCount) {
                blocks[0] = blocks[blockCount];
                for (i = 1; i < blockCount + 1; ++i) {
                    blocks[i] = 0;
                }
            }
            blocks[blockCount - 1] |= 0x80000000;
            for (i = 0; i < blockCount; ++i) {
                s[i] ^= blocks[i];
            }
            f(s);
        };

        Keccak.prototype.toString = Keccak.prototype.hex = function () {
            this.finalize();

            var blockCount = this.blockCount,
                s = this.s,
                outputBlocks = this.outputBlocks,
                extraBytes = this.extraBytes,
                i = 0,
                j = 0;
            var hex = '',
                block;
            while (j < outputBlocks) {
                for (i = 0; i < blockCount && j < outputBlocks; ++i, ++j) {
                    block = s[i];
                    hex +=
                        HEX_CHARS[(block >> 4) & 0x0f] +
                        HEX_CHARS[block & 0x0f] +
                        HEX_CHARS[(block >> 12) & 0x0f] +
                        HEX_CHARS[(block >> 8) & 0x0f] +
                        HEX_CHARS[(block >> 20) & 0x0f] +
                        HEX_CHARS[(block >> 16) & 0x0f] +
                        HEX_CHARS[(block >> 28) & 0x0f] +
                        HEX_CHARS[(block >> 24) & 0x0f];
                }
                if (j % blockCount === 0) {
                    f(s);
                    i = 0;
                }
            }
            if (extraBytes) {
                block = s[i];
                hex += HEX_CHARS[(block >> 4) & 0x0f] + HEX_CHARS[block & 0x0f];
                if (extraBytes > 1) {
                    hex += HEX_CHARS[(block >> 12) & 0x0f] + HEX_CHARS[(block >> 8) & 0x0f];
                }
                if (extraBytes > 2) {
                    hex += HEX_CHARS[(block >> 20) & 0x0f] + HEX_CHARS[(block >> 16) & 0x0f];
                }
            }
            return hex;
        };

        Keccak.prototype.arrayBuffer = function () {
            this.finalize();

            var blockCount = this.blockCount,
                s = this.s,
                outputBlocks = this.outputBlocks,
                extraBytes = this.extraBytes,
                i = 0,
                j = 0;
            var bytes = this.outputBits >> 3;
            var buffer;
            if (extraBytes) {
                buffer = new ArrayBuffer((outputBlocks + 1) << 2);
            } else {
                buffer = new ArrayBuffer(bytes);
            }
            var array = new Uint32Array(buffer);
            while (j < outputBlocks) {
                for (i = 0; i < blockCount && j < outputBlocks; ++i, ++j) {
                    array[j] = s[i];
                }
                if (j % blockCount === 0) {
                    f(s);
                }
            }
            if (extraBytes) {
                array[i] = s[i];
                buffer = buffer.slice(0, bytes);
            }
            return buffer;
        };

        Keccak.prototype.buffer = Keccak.prototype.arrayBuffer;

        Keccak.prototype.digest = Keccak.prototype.array = function () {
            this.finalize();

            var blockCount = this.blockCount,
                s = this.s,
                outputBlocks = this.outputBlocks,
                extraBytes = this.extraBytes,
                i = 0,
                j = 0;
            var array = [],
                offset,
                block;
            while (j < outputBlocks) {
                for (i = 0; i < blockCount && j < outputBlocks; ++i, ++j) {
                    offset = j << 2;
                    block = s[i];
                    array[offset] = block & 0xff;
                    array[offset + 1] = (block >> 8) & 0xff;
                    array[offset + 2] = (block >> 16) & 0xff;
                    array[offset + 3] = (block >> 24) & 0xff;
                }
                if (j % blockCount === 0) {
                    f(s);
                }
            }
            if (extraBytes) {
                offset = j << 2;
                block = s[i];
                array[offset] = block & 0xff;
                if (extraBytes > 1) {
                    array[offset + 1] = (block >> 8) & 0xff;
                }
                if (extraBytes > 2) {
                    array[offset + 2] = (block >> 16) & 0xff;
                }
            }
            return array;
        };

        function Kmac(bits, padding, outputBits) {
            Keccak.call(this, bits, padding, outputBits);
        }

        Kmac.prototype = new Keccak();

        Kmac.prototype.finalize = function () {
            this.encode(this.outputBits, true);
            return Keccak.prototype.finalize.call(this);
        };

        var f = function (s) {
            var h,
                l,
                n,
                c0,
                c1,
                c2,
                c3,
                c4,
                c5,
                c6,
                c7,
                c8,
                c9,
                b0,
                b1,
                b2,
                b3,
                b4,
                b5,
                b6,
                b7,
                b8,
                b9,
                b10,
                b11,
                b12,
                b13,
                b14,
                b15,
                b16,
                b17,
                b18,
                b19,
                b20,
                b21,
                b22,
                b23,
                b24,
                b25,
                b26,
                b27,
                b28,
                b29,
                b30,
                b31,
                b32,
                b33,
                b34,
                b35,
                b36,
                b37,
                b38,
                b39,
                b40,
                b41,
                b42,
                b43,
                b44,
                b45,
                b46,
                b47,
                b48,
                b49;
            for (n = 0; n < 48; n += 2) {
                c0 = s[0] ^ s[10] ^ s[20] ^ s[30] ^ s[40];
                c1 = s[1] ^ s[11] ^ s[21] ^ s[31] ^ s[41];
                c2 = s[2] ^ s[12] ^ s[22] ^ s[32] ^ s[42];
                c3 = s[3] ^ s[13] ^ s[23] ^ s[33] ^ s[43];
                c4 = s[4] ^ s[14] ^ s[24] ^ s[34] ^ s[44];
                c5 = s[5] ^ s[15] ^ s[25] ^ s[35] ^ s[45];
                c6 = s[6] ^ s[16] ^ s[26] ^ s[36] ^ s[46];
                c7 = s[7] ^ s[17] ^ s[27] ^ s[37] ^ s[47];
                c8 = s[8] ^ s[18] ^ s[28] ^ s[38] ^ s[48];
                c9 = s[9] ^ s[19] ^ s[29] ^ s[39] ^ s[49];

                h = c8 ^ ((c2 << 1) | (c3 >>> 31));
                l = c9 ^ ((c3 << 1) | (c2 >>> 31));
                s[0] ^= h;
                s[1] ^= l;
                s[10] ^= h;
                s[11] ^= l;
                s[20] ^= h;
                s[21] ^= l;
                s[30] ^= h;
                s[31] ^= l;
                s[40] ^= h;
                s[41] ^= l;
                h = c0 ^ ((c4 << 1) | (c5 >>> 31));
                l = c1 ^ ((c5 << 1) | (c4 >>> 31));
                s[2] ^= h;
                s[3] ^= l;
                s[12] ^= h;
                s[13] ^= l;
                s[22] ^= h;
                s[23] ^= l;
                s[32] ^= h;
                s[33] ^= l;
                s[42] ^= h;
                s[43] ^= l;
                h = c2 ^ ((c6 << 1) | (c7 >>> 31));
                l = c3 ^ ((c7 << 1) | (c6 >>> 31));
                s[4] ^= h;
                s[5] ^= l;
                s[14] ^= h;
                s[15] ^= l;
                s[24] ^= h;
                s[25] ^= l;
                s[34] ^= h;
                s[35] ^= l;
                s[44] ^= h;
                s[45] ^= l;
                h = c4 ^ ((c8 << 1) | (c9 >>> 31));
                l = c5 ^ ((c9 << 1) | (c8 >>> 31));
                s[6] ^= h;
                s[7] ^= l;
                s[16] ^= h;
                s[17] ^= l;
                s[26] ^= h;
                s[27] ^= l;
                s[36] ^= h;
                s[37] ^= l;
                s[46] ^= h;
                s[47] ^= l;
                h = c6 ^ ((c0 << 1) | (c1 >>> 31));
                l = c7 ^ ((c1 << 1) | (c0 >>> 31));
                s[8] ^= h;
                s[9] ^= l;
                s[18] ^= h;
                s[19] ^= l;
                s[28] ^= h;
                s[29] ^= l;
                s[38] ^= h;
                s[39] ^= l;
                s[48] ^= h;
                s[49] ^= l;

                b0 = s[0];
                b1 = s[1];
                b32 = (s[11] << 4) | (s[10] >>> 28);
                b33 = (s[10] << 4) | (s[11] >>> 28);
                b14 = (s[20] << 3) | (s[21] >>> 29);
                b15 = (s[21] << 3) | (s[20] >>> 29);
                b46 = (s[31] << 9) | (s[30] >>> 23);
                b47 = (s[30] << 9) | (s[31] >>> 23);
                b28 = (s[40] << 18) | (s[41] >>> 14);
                b29 = (s[41] << 18) | (s[40] >>> 14);
                b20 = (s[2] << 1) | (s[3] >>> 31);
                b21 = (s[3] << 1) | (s[2] >>> 31);
                b2 = (s[13] << 12) | (s[12] >>> 20);
                b3 = (s[12] << 12) | (s[13] >>> 20);
                b34 = (s[22] << 10) | (s[23] >>> 22);
                b35 = (s[23] << 10) | (s[22] >>> 22);
                b16 = (s[33] << 13) | (s[32] >>> 19);
                b17 = (s[32] << 13) | (s[33] >>> 19);
                b48 = (s[42] << 2) | (s[43] >>> 30);
                b49 = (s[43] << 2) | (s[42] >>> 30);
                b40 = (s[5] << 30) | (s[4] >>> 2);
                b41 = (s[4] << 30) | (s[5] >>> 2);
                b22 = (s[14] << 6) | (s[15] >>> 26);
                b23 = (s[15] << 6) | (s[14] >>> 26);
                b4 = (s[25] << 11) | (s[24] >>> 21);
                b5 = (s[24] << 11) | (s[25] >>> 21);
                b36 = (s[34] << 15) | (s[35] >>> 17);
                b37 = (s[35] << 15) | (s[34] >>> 17);
                b18 = (s[45] << 29) | (s[44] >>> 3);
                b19 = (s[44] << 29) | (s[45] >>> 3);
                b10 = (s[6] << 28) | (s[7] >>> 4);
                b11 = (s[7] << 28) | (s[6] >>> 4);
                b42 = (s[17] << 23) | (s[16] >>> 9);
                b43 = (s[16] << 23) | (s[17] >>> 9);
                b24 = (s[26] << 25) | (s[27] >>> 7);
                b25 = (s[27] << 25) | (s[26] >>> 7);
                b6 = (s[36] << 21) | (s[37] >>> 11);
                b7 = (s[37] << 21) | (s[36] >>> 11);
                b38 = (s[47] << 24) | (s[46] >>> 8);
                b39 = (s[46] << 24) | (s[47] >>> 8);
                b30 = (s[8] << 27) | (s[9] >>> 5);
                b31 = (s[9] << 27) | (s[8] >>> 5);
                b12 = (s[18] << 20) | (s[19] >>> 12);
                b13 = (s[19] << 20) | (s[18] >>> 12);
                b44 = (s[29] << 7) | (s[28] >>> 25);
                b45 = (s[28] << 7) | (s[29] >>> 25);
                b26 = (s[38] << 8) | (s[39] >>> 24);
                b27 = (s[39] << 8) | (s[38] >>> 24);
                b8 = (s[48] << 14) | (s[49] >>> 18);
                b9 = (s[49] << 14) | (s[48] >>> 18);

                s[0] = b0 ^ (~b2 & b4);
                s[1] = b1 ^ (~b3 & b5);
                s[10] = b10 ^ (~b12 & b14);
                s[11] = b11 ^ (~b13 & b15);
                s[20] = b20 ^ (~b22 & b24);
                s[21] = b21 ^ (~b23 & b25);
                s[30] = b30 ^ (~b32 & b34);
                s[31] = b31 ^ (~b33 & b35);
                s[40] = b40 ^ (~b42 & b44);
                s[41] = b41 ^ (~b43 & b45);
                s[2] = b2 ^ (~b4 & b6);
                s[3] = b3 ^ (~b5 & b7);
                s[12] = b12 ^ (~b14 & b16);
                s[13] = b13 ^ (~b15 & b17);
                s[22] = b22 ^ (~b24 & b26);
                s[23] = b23 ^ (~b25 & b27);
                s[32] = b32 ^ (~b34 & b36);
                s[33] = b33 ^ (~b35 & b37);
                s[42] = b42 ^ (~b44 & b46);
                s[43] = b43 ^ (~b45 & b47);
                s[4] = b4 ^ (~b6 & b8);
                s[5] = b5 ^ (~b7 & b9);
                s[14] = b14 ^ (~b16 & b18);
                s[15] = b15 ^ (~b17 & b19);
                s[24] = b24 ^ (~b26 & b28);
                s[25] = b25 ^ (~b27 & b29);
                s[34] = b34 ^ (~b36 & b38);
                s[35] = b35 ^ (~b37 & b39);
                s[44] = b44 ^ (~b46 & b48);
                s[45] = b45 ^ (~b47 & b49);
                s[6] = b6 ^ (~b8 & b0);
                s[7] = b7 ^ (~b9 & b1);
                s[16] = b16 ^ (~b18 & b10);
                s[17] = b17 ^ (~b19 & b11);
                s[26] = b26 ^ (~b28 & b20);
                s[27] = b27 ^ (~b29 & b21);
                s[36] = b36 ^ (~b38 & b30);
                s[37] = b37 ^ (~b39 & b31);
                s[46] = b46 ^ (~b48 & b40);
                s[47] = b47 ^ (~b49 & b41);
                s[8] = b8 ^ (~b0 & b2);
                s[9] = b9 ^ (~b1 & b3);
                s[18] = b18 ^ (~b10 & b12);
                s[19] = b19 ^ (~b11 & b13);
                s[28] = b28 ^ (~b20 & b22);
                s[29] = b29 ^ (~b21 & b23);
                s[38] = b38 ^ (~b30 & b32);
                s[39] = b39 ^ (~b31 & b33);
                s[48] = b48 ^ (~b40 & b42);
                s[49] = b49 ^ (~b41 & b43);

                s[0] ^= RC[n];
                s[1] ^= RC[n + 1];
            }
        };

        return methods.sha3_256(strInput);
    }
}

module.exports = {
    DidNsV2
};
