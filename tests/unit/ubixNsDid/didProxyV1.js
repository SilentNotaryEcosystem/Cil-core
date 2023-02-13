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

class DidProxyV1 extends Base {
    constructor() {
        super();
        this._updateFee = 1000; // TODO: Make it very expencive
        this._didContracts = []; // latest proxy contract address is the actual
        this._strActiveDidContractAddress = null;
    }

    getData() {
        return {address: this._strActiveDidContractAddress, data: this._didContracts};
    }

    add(objData) {
        this._validatePermissions();
        this._validateObjData(objData);

        // validate here
        this._didContracts.push([callerAddress, objData.strIssuerName, objData.strDidContractAddress]);
        this._strActiveDidContractAddress = objData.strDidContractAddress;
    }

    async resolve(strProvider, strName) {
        return await call(this._strActiveDidContractAddress, {
            method: 'resolve',
            arrArguments: [strProvider, strName]
        });
    }

    async get(strDidAddress) {
        this._validatePermissions();

        return await call(this._strActiveDidContractAddress, {
            method: 'get',
            arrArguments: [strDidAddress]
        });
    }

    async create(objData) {
        this._validatePermissions();

        this._validatePermissions();
        return await call(this._strActiveDidContractAddress, {
            method: 'create',
            arrArguments: [objData]
        });
    }

    async remove(strDidAddress) {
        this._validatePermissions();

        this._validatePermissions();
        return await call(this._strActiveDidContractAddress, {
            method: 'remove',
            arrArguments: [strDidAddress]
        });
    }

    async replace(strDidAddress, objNewData) {
        this._validatePermissions();

        return await call(this._strActiveDidContractAddress, {
            method: 'replace',
            arrArguments: [strDidAddress, objNewData]
        });
    }

    _validatePermissions() {
        if (!callerAddress) throw new Error('You should sign TX');
        if (value < this._updateFee) throw new Error(`Update fee is ${this._updateFee}`);
    }

    _validateObjData(objData) {
        if (
            typeof objData !== 'object' ||
            typeof objData.strIssuerName !== 'string' ||
            typeof objData.strDidContractAddress !== 'string'
        ) {
            throw new Error('objData has wrong format');
        }
    }
}

module.exports = {
    DidProxyV1
};
