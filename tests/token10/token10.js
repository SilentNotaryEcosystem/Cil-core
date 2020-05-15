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

class Token10 extends Base {

    constructor() {
        super();

        this._createFee = 130000;
        this._data = {};
    }

    createToken(objTokenData) {
        if (!callerAddress) throw ('You should sign TX');
        if (value < this._createFee) throw (`Create fee is ${this._createFee}`);

        this._validateTokenParameters(objTokenData);
        const {strSymbol, nTotalSupply, strIssuerName, strGoals, decimals = 0} = objTokenData;
        this._validateAmount(nTotalSupply, 'nTotalSupply');
        this._validateAmount(decimals, 'decimals', true);

        this._data[strSymbol.toUpperCase()] = [
            nTotalSupply,
            strIssuerName,
            strGoals,
            callerAddress,
            {
                [callerAddress]: [{}, nTotalSupply]
            },
            [block.hash],
            false,
            decimals
        ];
    }

    tokenData(strSymbol) {
        const {nTotalSupply, strIssuerName, strGoals, strOwner, arrTxHashChanges, decimals} = this._getTokenData(
            strSymbol);

        return {nTotalSupply, strIssuerName, strGoals, strOwner, arrTxHashChanges, decimals};
    }

    decimals(strSymbol) {
        return this._getTokenData(strSymbol).decimals;
    }

    balanceOf(strSymbol, strWho) {
        this._validateAddress(strWho);

        const {objHolders} = this._getTokenData(strSymbol);

        return this._getBalance(objHolders, strWho) || 0;
    }

    allowance(strSymbol, strOwner, strSpender) {
        this._validateAddress(strOwner);
        this._validateAddress(strSpender);

        const {objHolders} = this._getTokenData(strSymbol);
        return this._getAllowance(objHolders, strOwner, strSpender);
    }

    approve(strSymbol, strSpender, amount) {
        if (!callerAddress) throw ('You should sign TX');

        this._validateAddress(strSpender);
        this._validateAmount(amount, 'amount');

        const {objHolders} = this._getTokenData(strSymbol);

        global.bIndirectCall = true;
        this._setAllowance(objHolders, callerAddress, strSpender, amount);
    }

    transferFrom(strSymbol, strFrom, strTo, amount) {
        if (!callerAddress) throw ('You should sign TX');

        this._validateAddress(strFrom);
        this._validateAddress(strTo);
        this._validateAmount(amount, 'amount');

        const {objHolders, isFrozen} = this._getTokenData(strSymbol);
        if (isFrozen) throw ('Token is frozen. No transfers allowed');

        const nAllowedAmount = this._getAllowance(objHolders, strFrom, callerAddress);

        if (amount > nAllowedAmount) throw (`Allowed to transfer at most ${nAllowedAmount} of ${strSymbol}`);

        global.bIndirectCall = true;
        this._transferFromTo(objHolders, strFrom, strTo, amount);
        this._setAllowance(objHolders, strFrom, callerAddress, nAllowedAmount - amount);
    }

    transfer(strSymbol, strTo, amount) {
        if (!callerAddress) throw ('You should sign TX');

        this._validateAddress(strTo);
        this._validateAmount(amount, 'amount');

        const {objHolders, isFrozen} = this._getTokenData(strSymbol);
        if (isFrozen) throw ('Token is frozen. No transfers allowed');

        global.bIndirectCall = true;
        this._transferFromTo(objHolders, callerAddress, strTo, amount);
    }

    emitMoreTokens(strSymbol, nAmount) {
        if (!callerAddress) throw ('You should sign TX');

        this._validateAmount(nAmount, 'amount');
        const {nTotalSupply, objHolders, strOwner, arrTxHashChanges} = this._getTokenData(strSymbol);

        if (callerAddress !== strOwner) throw ('You arent an owner');

        const nHas = this._getBalance(objHolders, callerAddress);
        this._validateAmount(nHas + nAmount, 'Total supply');

        global.bIndirectCall = true;
        this._setBalance(objHolders, callerAddress, nHas + nAmount);
        this._setTotalSupply(strSymbol, nTotalSupply + nAmount);
        arrTxHashChanges.push(block.hash);
    }

    freeze(strSymbol) {
        if (!callerAddress) throw ('You should sign TX');

        const {strOwner, arrTxHashChanges} = this._getTokenData(strSymbol);
        if (callerAddress !== strOwner) throw ('You arent an owner');

        global.bIndirectCall = true;
        this._setFreeze(strSymbol);
        arrTxHashChanges.push(block.hash);
    }

    isFrozen(strSymbol) {
        const {isFrozen} = this._getTokenData(strSymbol);
        return isFrozen;
    }

    _validateTokenParameters(objTokenData) {
        const {strSymbol, nTotalSupply, strIssuerName, strGoals} = objTokenData;

        if (typeof strSymbol !== 'string') throw ('Symbol should be a string');
        if (strSymbol.length > 6) throw ('Symbol should be at most 6 chars');
        if (this._data[strSymbol.toUpperCase()]) throw ('Symbol already exists');

        this._validateAmount(nTotalSupply, 'nTotalSupply');

        if (typeof strIssuerName !== 'string') throw ('strIssuerName should be a string');
        if (typeof strGoals !== 'string') throw ('strGoals should be a string');
    }

    _getTokenData(strSymbol) {
        strSymbol = strSymbol.toUpperCase();
        if (!this._data[strSymbol]) throw ('Symbol doesn\'t exists');

        const [nTotalSupply, strIssuerName, strGoals, strOwner, objHolders, arrTxHashChanges, isFrozen, decimals] = this._data[strSymbol];

        return {nTotalSupply, strIssuerName, strGoals, strOwner, objHolders, arrTxHashChanges, isFrozen, decimals};
    }

    _getBalance(objHolders, strWho) {
        return Array.isArray(objHolders[strWho]) ? objHolders[strWho][1] : 0;
    }

    _setTotalSupply(strSymbol, nSupply) {
        if (!global.bIndirectCall) throw ('You aren\'t supposed to be here');

        strSymbol = strSymbol.toUpperCase();
        this._data[strSymbol][0] = nSupply;
    }

    _setFreeze(strSymbol) {
        if (!global.bIndirectCall) throw ('You aren\'t supposed to be here');

        strSymbol = strSymbol.toUpperCase();
        this._data[strSymbol][6] = true;
    }

    _setBalance(objHolders, strWho, nNewBalance) {
        if (!global.bIndirectCall) throw ('You aren\'t supposed to be here');

        if (!objHolders[strWho]) {
            objHolders[strWho] = [{}, nNewBalance];
        } else {
            objHolders[strWho][1] = nNewBalance;
        }
    }

    _transferFromTo(objHolders, strFrom, strTo, amount) {
        if (!global.bIndirectCall) throw ('You aren\'t supposed to be here');

        const nHas = this._getBalance(objHolders, strFrom);
        if (amount > nHas) throw (`${strFrom} has only ${nHas}`);

        this._setBalance(objHolders, strFrom, nHas - amount);
        this._setBalance(objHolders, strTo, this._getBalance(objHolders, strTo) + amount);
    }

    _getAllowance(objHolders, strHolder, strSpender) {
        return Array.isArray(objHolders[strHolder]) ? objHolders[strHolder][0][strSpender] || 0 : 0;
    }

    _setAllowance(objHolders, strHolder, strAllowTo, amount) {
        if (!global.bIndirectCall) throw ('You aren\'t supposed to be here');

        if (!objHolders[strHolder]) {
            objHolders[strHolder] = [{[strAllowTo]: amount}, 0];
        } else {
            objHolders[strHolder][0][strAllowTo] = amount;
        }
    }

    _validateAmount(amount, strParameterName, bAllowZero = false) {
        if (typeof amount !== 'number') throw (`${strParameterName} should be a number`);
        if (!bAllowZero && amount === 0 || amount < 0) throw (`${strParameterName} should be positive`);
        if (amount > Number.MAX_SAFE_INTEGER) {
            throw (`${strParameterName} should be less than ${Number.MAX_SAFE_INTEGER}`);
        }
        if (amount !== Math.round(amount)) throw (`${strParameterName} should be an integer`);
    }
};

module.exports = {
    Base,
    Token10
};
