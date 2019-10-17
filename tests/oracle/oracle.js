class Base {
    constructor(props) {
        this._ownerAddress = callerAddress;
    }

    __getCode() {
        const arrFunctionsToPropagateFromBase = [
            '_checkOwner', '_transferOwnership', '_validateAddress', 'addManager', 'removeManager'
        ];

        const methods = Object
            .getOwnPropertyNames(Object.getPrototypeOf(this))
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
        if (strAddress.length !== 40) throw ('Bad address');
    }

    _checkOwner() {
        if (this._ownerAddress !== callerAddress) throw ('Unauthorized call');
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

        if (!this._managers) throw ('Unauthorized call');
        if (!~this._managers.findIndex(strAddr => strAddr === callerAddress)) throw ('Unauthorized call');
    }
}

class RatesOracle extends Base {

    // TODO: add purger for old data?
    constructor() {
        super();

        this._data = {};
    }

    publish(strTicker, value) {
        this._checkManager();

        this._ensureTicker(strTicker);

        // this will save a storage for us
        const nTimeBase = block.timestamp - this._data[strTicker].timeBase;

        this._data[strTicker].arrData.push([nTimeBase, value]);
    }

    publishBatch(arrValues) {
        this._checkManager();

        arrValues.forEach(([strTicker, value]) => this.publish(strTicker, value));
    }

    _ensureTicker(strTicker) {
        if (this._data[strTicker]) return;

        this._data[strTicker] = {
            timeBase: block.timestamp,
            arrData: []
        };
    }

    getDataForTicker(strTicker, nCount = 1440) {
        if (!this._data[strTicker]) throw (`Ticker ${strTicker} not found`);

        const nTimeBase = this._data[strTicker].timeBase;
        return this._data[strTicker].arrData.slice(0 - nCount).map(([nOffset, value]) => [nTimeBase + nOffset, value]);
    }
};

module.exports = {
    Base,
    RatesOracle
};
