const factory = {
    BaseConciliumDefinition: {
        CONCILIUM_TYPE_POS: 1,
        CONCILIUM_TYPE_RR: 0
    },
    Constants: {
        concilium: {
            HEIGHT_TO_RELEASE_ADD_ON: 1e4
        }
    }
};

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

module.exports = class Concilium extends Base {
    constructor(objInitialConcilium, nFeeCreate) {
        super();
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
        objConcilium.creator = callerAddress;

        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {method: "createConcilium", arrArguments: [objConcilium]});
        }

        this._checkFeeCreate(value);
        this._validateConcilium(objConcilium);

        this._arrConciliums.push({
            ...objConcilium,
            conciliumId: this._arrConciliums.length,
            conciliumCreationTx: contractTx
        });
    }

    async joinConcilium(conciliumId) {
        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {method: "joinConcilium", arrArguments: [conciliumId]});
        }

        const objConcilium = this._checkConciliumId(conciliumId);

        if (!objConcilium.isOpen) throw ('You cant join this concilium. Ask about invitation');

//        if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS}) {
        if (objConcilium.type === factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS) {
            this._addPosConciliumMember(objConcilium);
//        } else if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_RR}) {
        } else if (objConcilium.type === factory.BaseConciliumDefinition.CONCILIUM_TYPE_RR) {
            this._addRrConciliumMember(objConcilium);
        }
    }

    async leaveConcilium(conciliumId) {
        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {method: "leaveConcilium", arrArguments: [conciliumId]});
        }

        const objConcilium = this._checkConciliumId(conciliumId);

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

        this._checkCreator();

        const objConcilium = this._checkConciliumId(conciliumId);
        if (objConcilium.isOpen) throw ('This concilium is open, just join it');

        //        if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_RR}) {
        if (!objConcilium.type !== factory.BaseConciliumDefinition.CONCILIUM_TYPE_RR) {
            throw ('this method only for CONCILIUM_TYPE_RR');
        }

        this._addRrConciliumMember(objConcilium, callerAddress);
    }

    setFeeCreate(nFeeNew) {
        this._checkOwner();
        this._feeCreate = nFeeNew;
    }

    setProxy(strNewAddress) {
        if (strNewAddress.length !== 20) throw ('Bad address');

        this._checkOwner();
        this._proxyAddress = strNewAddress;
    }

    // PoS concilium
    _posConciliumMemberExists(objConcilium, callerAddress) {
        if (!Array.isArray(objConcilium.arrMembers)) objConcilium.arrMembers = [];
        return !objConcilium.arrMembers.every(objExistedMember => objExistedMember.address !== callerAddress);
    }

    _addPosConciliumMember(objConcilium) {
        if (this._posConciliumMemberExists(objConcilium, callerAddress)) throw ('already joined');

        this._checkDepositJoin(objConcilium, value);

        objConcilium.arrMembers.push({
            address: callerAddress,
            amount: value,
//            nHeightToRelease: block.height +${factory.Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON}
            nHeightToRelease: block.height + factory.Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON
        });
    }

    _retirePosConciliumMember(objConcilium, callerAddress) {
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

    // Round robin concilium
    _rRConciliumMemberExists(objConcilium, callerAddress) {
        if (!Array.isArray(objConcilium.addresses)) objConcilium.addresses = [];
        return !objConcilium.addresses.every(strMemberAddr => strMemberAddr !== callerAddress);
    }

    _addRrConciliumMember(objConcilium, callerAddress) {
        if (this._rRConciliumMemberExists(objConcilium, callerAddress)) throw ('already joined');
        objConcilium.addresses.push(callerAddress);
    }

    _retireRrConciliumMember(objConcilium, callerAddress) {
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

    _checkCreator(objConcilium) {
        if (objConcilium.creator !== callerAddress) throw ('Unauthorized call');
    }

    _validateConcilium(objConcilium) {
//        if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS}) {
        if (objConcilium.type === factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS) {
            if (!objConcilium.nMinAmountToJoin || objConcilium.nMinAmountToJoin < 0) throw ('Specify nMinAmountToJoin');
        }
    }
};
