const factory = require('../testFactory');

class Base {
    constructor(props) {
        this._ownerAddress = callerAddress;
    }

    __getCode() {
        const methods = Object
            .getOwnPropertyNames(Object.getPrototypeOf(this))
            .filter(name => name !== 'constructor' && typeof this[name] === 'function');
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

    _checkOwner() {
        if (this._ownerAddress !== callerAddress) throw ('Unauthorized call');
    }
}

module.exports = class ContractConciliums extends Base {
    constructor(objInitialConcilium, nFeeCreate) {
        super();

        // remove everything below for proxy!
        this._arrConciliums = [];
        if (!objInitialConcilium) throw('Specify initial objInitialConcilium');

        this._arrConciliums.push({
            ...objInitialConcilium,
            conciliumCreationTx: contractTx
        });

        if (nFeeCreate) this.setFeeCreate(nFeeCreate);
        this._proxyAddress = undefined;
    }

    async createConcilium(objConcilium) {
        objConcilium._creator = callerAddress;

        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {method: "createConcilium", arrArguments: [objConcilium]});
        }

        this._checkFeeCreate(value);
        this._validateConcilium(objConcilium);

        this._arrConciliums.push({
            ...objConcilium,
            conciliumId: this._arrConciliums.length,
            conciliumCreationTx: contractTx,
            parameterTXNs: []
        });
    }

    async joinConcilium(conciliumId) {

        // remove for proxy contract!
        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {method: "joinConcilium", arrArguments: [conciliumId]});
        }

        conciliumId = parseInt(conciliumId);

        // this will also include failure to join conciliumId 0. it's ok!
        if (!conciliumId) throw ('Invalid concilium');

        const objConcilium = this._checkConciliumId(conciliumId);

        if (!objConcilium.isOpen) throw ('You cant join this concilium. Ask about invitation');

        global.bIndirectCall = true;

//        if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS}) {
        if (objConcilium.type === factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS) {
            this._addPosConciliumMember(objConcilium, callerAddress);
//        } else if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_RR}) {
        } else if (objConcilium.type === factory.BaseConciliumDefinition.CONCILIUM_TYPE_RR) {
            this._addRrConciliumMember(objConcilium, callerAddress);
        }
    }

    async leaveConcilium(conciliumId) {

        // remove for proxy contract!
        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {method: "leaveConcilium", arrArguments: [conciliumId]});
        }

        conciliumId = parseInt(conciliumId);

        // this will also include failure to leave conciliumId 0. it's ok!
        if (!conciliumId) throw ('Invalid concilium');

        const objConcilium = this._checkConciliumId(conciliumId);

        global.bIndirectCall = true;

//        if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS}) {
        if (objConcilium.type === factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS) {
            this._retirePosConciliumMember(objConcilium, callerAddress);
//        } else if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_RR}) {
        } else if (objConcilium.type === factory.BaseConciliumDefinition.CONCILIUM_TYPE_RR) {
            this._retireRrConciliumMember(objConcilium, callerAddress);
        }
    }

    async inviteToConcilium(conciliumId, arrAddresses) {
        if (this._proxyAddress) {
            return await delegatecall(
                this._proxyAddress,
                {method: "inviteToConcilium", arrArguments: [conciliumId, arrAddresses]}
            );
        }

        const objConcilium = this._checkConciliumId(conciliumId);
        this._checkCreator(objConcilium, callerAddress);

        if (objConcilium.isOpen) throw ('This concilium is open, just join it');

        global.bIndirectCall = true;

//        if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_RR}) {
        if (objConcilium.type === factory.BaseConciliumDefinition.CONCILIUM_TYPE_RR) {
            arrAddresses.forEach(addr => this._addRrConciliumMember(objConcilium, addr));
//        } else if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS}) {
        } else if (objConcilium.type === factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS) {
            arrAddresses.forEach(addr => this._addPosConciliumMember(objConcilium, addr, value / arrAddresses.length));
        }
    }

    setFeeCreate(nFeeNew) {
        this._checkOwner();
        this._feeCreate = nFeeNew;
    }

    setProxy(strNewAddress) {
        if (strNewAddress.length !== 40) throw ('Bad address');

        this._checkOwner();
        this._proxyAddress = strNewAddress;
    }

    async getHeightToRelease(conciliumId) {
        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {method: "getHeightToRelease", arrArguments: [conciliumId]});
        }

        const objConcilium = this._checkConciliumId(conciliumId);

//        if (objConcilium.type !== ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS}) {
        if (objConcilium.type !== factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS) {
            throw ('this method only for CONCILIUM_TYPE_POS');
        }

        return this._getPosHeightToRelease(objConcilium, callerAddress);
    }

    async changeConciliumParameters(conciliumId, objNewParameters) {
        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress,
                {method: "changeConciliumParameters", arrArguments: [conciliumId, objNewParameters]}
            );
        }

        const objConcilium = this._checkConciliumId(conciliumId);
        this._checkCreator(objConcilium, callerAddress);

        global.bIndirectCall = true;

        const oldFees = objConcilium.parameters && objConcilium.parameters.fees ? objConcilium.parameters.fees : {};
        objConcilium.parameters.fees = {...oldFees, ...objNewParameters.fees};
        objConcilium.parameters.isEnabled = objNewParameters.isEnabled !== undefined ?
            objNewParameters.isEnabled : objConcilium.parameters.isEnabled;
        objConcilium.parameters.document = objNewParameters.document !== undefined ?
            objNewParameters.document : objConcilium.parameters.document;

        if (!Array.isArray(objConcilium.parameterTXNs)) objConcilium.parameterTXNs = [];
        objConcilium.parameterTXNs.push(contractTx);
    }

    // PoS concilium
    _getPosConciliumMember(objConcilium, callerAddress) {
        if (!Array.isArray(objConcilium.arrMembers)) objConcilium.arrMembers = [];
        return objConcilium.arrMembers.find(objExistedMember => objExistedMember.address === callerAddress);
    }

    _addPosConciliumMember(objConcilium, strAddress = callerAddress, nAmount = value) {
        if (!global.bIndirectCall) throw ('You aren\'t supposed to be here');

        if (!nAmount) throw (`Have no sense to join with zero amount`);

        const objMemberRecord = this._getPosConciliumMember(objConcilium, strAddress);

        // we allow rejoin with no less than minimum
        this._checkDepositJoin(objConcilium, nAmount);

        if (objMemberRecord) {

            // value (objMemberRecord) returned by ref, so no need to manipulate array
            objMemberRecord.amount += nAmount;
//            objMemberRecord.nHeightToRelease = block.height + ${factory.Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON}
            objMemberRecord.nHeightToRelease = block.height + factory.Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON;
        } else {
            objConcilium.arrMembers.push({
                address: strAddress,
                amount: nAmount,
//            nHeightToRelease: block.height + ${factory.Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON}
                nHeightToRelease: block.height + factory.Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON
            });

        }
    }

    _retirePosConciliumMember(objConcilium, callerAddress) {
        if (!global.bIndirectCall) throw ('You aren\'t supposed to be here');

        const idx = objConcilium.arrMembers.findIndex(member => member.address === callerAddress);
        if (!~idx) throw ('You aren\'t member');

        const objMember = objConcilium.arrMembers[idx];
        if (objMember.nHeightToRelease > block.height) throw ('Don\'t leave us now');

        send(objMember.address, objMember.amount);
        objConcilium.arrMembers.splice(idx, 1);
    }

    _checkDepositJoin(objConcilium, value) {
        if (value < objConcilium.nMinAmountToJoin) {
            throw ('You should send at least ' + objConcilium.nMinAmountToJoin + 'coins');
        }
    }

    _getPosHeightToRelease(objConcilium, callerAddress) {
        const idx = objConcilium.arrMembers.findIndex(member => member.address === callerAddress);
        if (!~idx) throw ('You aren\'t member');

        const objMember = objConcilium.arrMembers[idx];
        return objMember.nHeightToRelease;
    }

    // Round robin concilium
    _rrConciliumMemberExists(objConcilium, callerAddress) {
        if (!Array.isArray(objConcilium.addresses)) objConcilium.addresses = [];
        return !objConcilium.addresses.every(strMemberAddr => strMemberAddr !== callerAddress);
    }

    _addRrConciliumMember(objConcilium, callerAddress) {
        if (!global.bIndirectCall) throw ('You aren\'t supposed to be here');

        if (this._rrConciliumMemberExists(objConcilium, callerAddress)) throw ('already joined');
        objConcilium.addresses.push(callerAddress);
    }

    _retireRrConciliumMember(objConcilium, callerAddress) {
        if (!global.bIndirectCall) throw ('You aren\'t supposed to be here');

        const idx = objConcilium.addresses.findIndex(addr => addr === callerAddress);
        if (!~idx) throw ('You aren\'t member');
        objConcilium.addresses.splice(idx, 1);
    }

    // common
    _checkConciliumId(conciliumId) {
        if (conciliumId > this._arrConciliums.length || conciliumId < 0) throw ('Bad conciliumId');
        return this._arrConciliums[conciliumId];
    }

    _checkFeeCreate(nFee) {
        if (!this._feeCreate) throw ('Set _feeCreate first');
        if (this._feeCreate > nFee) throw ('Not enough funds');
    }

    _checkCreator(objConcilium, callerAddress) {
        if (objConcilium._creator) {
            if (objConcilium._creator !== callerAddress) throw ('Unauthorized call');
        } else {
            this._checkOwner();
        }
    }

    _validateConcilium(objConcilium) {
//        if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS}) {
        if (objConcilium.type === factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS) {
            if (!Array.isArray(objConcilium.arrMembers)) objConcilium.arrMembers = [];

            if (!objConcilium.nMinAmountToJoin || objConcilium.nMinAmountToJoin < 0) throw ('Specify nMinAmountToJoin');

            const initialAmount = objConcilium.arrMembers.reduce((accum, objMember) => accum + objMember.amount, 0);
            if (this._feeCreate + initialAmount > value) throw ('Not enough coins were sent co create such concilium');
        }
    }
};
