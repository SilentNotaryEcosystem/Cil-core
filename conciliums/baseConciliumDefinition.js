'use strict';

const CONCILIUM_TYPE_RR = 0;
const CONCILIUM_TYPE_POS = 1;

const {deepCloneObject} = require('../utils');

// common parameters
//const def = {
//    conciliumId: 0, //     will be set by Concilium management contract
//    type: Constants.CONCILIUM_TYPE_POS | Constants.CONCILIUM_TYPE_RR,
//    parameters: {
//        fees: {
//            feeTxSize: 111,
//            feeContractCreation: 111,
//            feeContractInvocation: 111,
//            feeStorage: 111,
//            feeInternalTx: 111,
//        },
//        isEnabled: true,
//
//        SN hash of document with concilium description.
//        document: 'cf60920089b7db942206e6484ea7df51b01e7b1f77dd99c1ecdc766cf5c6a77a'
//    }
//};

module.exports = class BaseConciliumDefinition {
    constructor(data) {
        if (Buffer.isBuffer(data)) throw new Error('BaseConciliumDefinition. Unexpected construction from buffer');
        if (typeof data !== 'object') {
            throw new Error(
                `BaseConciliumDefinition. Unexpected construction from ${typeof data}`);
        }

        this._data = deepCloneObject(data);

        if (!this._data.parameters) {
            this._data.parameters = {
                fees: {},
                document: []
            };
        }
        this._data.parameters.isEnabled = true;

        this.changeSeed(0);
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

    getFeeContractCreation() {
        return this._data.parameters.fees ? this._data.parameters.fees.feeContractCreation : undefined;
    }

    getFeeContractInvocation() {
        return this._data.parameters.fees ? this._data.parameters.fees.feeContractInvocation : undefined;
    }

    getFeeStorage() {
        return this._data.parameters.fees ? this._data.parameters.fees.feeStorage : undefined;
    }

    getFeeInternalTx() {
        return this._data.parameters.fees ? this._data.parameters.fees.feeInternalTx : undefined;
    }

    validateBlock(block) {
        throw new Error('Implement!');
    }

    /**
     * We plan to use it punish scenario
     *
     * @returns {boolean}
     */
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

    /**
     * Redefine this to change proposing behavior
     *
     * @returns {String}
     */
    getProposerKey(roundNo) {
        throw new Error('Implement!');
    }

    initRounds() {
        throw new Error('Implement!');
    }

    getRound() {
        throw new Error('Implement!');
    }

    nextRound() {
        throw new Error('Implement!');
    }

    changeSeed(nSeed) {
        this._nSeed = nSeed;
    }

    getMembersCount() {
        throw new Error('Implement!');
    }

    getDocument() {
        return this._data.parameters.document;
    }
};
