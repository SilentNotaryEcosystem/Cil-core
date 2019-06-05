'use strict';

const CONCILIUM_TYPE_RR = 0;
const CONCILIUM_TYPE_POS = 1;

const {deepCloneObject} = require('../utils');

// common parameters
//const def = {
//    conciliumId: 0,
//    type: Constants.POS | Constants.CLOSED_RR,
//    parameters: {
//        fees: {
//            feeTxSize: 111,
//            feeContractCreation: 111,
//            feeContractInvocation: 111
//        },
//        isEnabled: true
//    }
//};

module.exports = class BaseConciliumDefinition {
    constructor(data) {
        if (Buffer.isBuffer(data)) throw new Error('BaseConciliumDefinition. Unexpected construction from buffer');
        if (typeof data !== 'object') {
            throw new Error(
                `BaseConciliumDefinition. Unexpected construction from ${typeof data}`);
        }
        if (data.conciliumId === undefined) throw new Error(`BaseConciliumDefinition. Specify conciliumId`);

        this._data = deepCloneObject(data);

        if (!this._data.parameters) {
            this._data.parameters = {
                fees: {},
                isEnabled: true
            };
        }
    }

    getType() {
        return this._data.type;
    }

    _setType(type) {
        return this._data.type = type;
    }

    toObject() {
        return this._data;
    }

    getConciliumId() {
        return this._data.conciliumId;
    }

    getFeeTxSize() {
        return this._data.parameters.fees ? this._data.parameters.fees.feeTxSize : undefined;
    }

    getContractCreationFee() {
        return this._data.parameters.fees ? this._data.parameters.fees.feeContractCreation : undefined;
    }

    getContractInvocationFee() {
        return this._data.parameters.fees ? this._data.parameters.fees.feeContractInvocation : undefined;
    }

    validateBlock(block) {
        throw new Error('Implement!');
    }

    isEnabled() {
        return this._data.parameters.isEnabled;
    }

    isRoundRobin() {
        return this._data.type === CONCILIUM_TYPE_RR;
    }

    isPoS() {
        return this._data.type === CONCILIUM_TYPE_POS;
    }

    static get CONCILIUM_TYPE_POS() {
        return CONCILIUM_TYPE_POS;
    }

    static get CONCILIUM_TYPE_RR() {
        return CONCILIUM_TYPE_RR;
    }
};
