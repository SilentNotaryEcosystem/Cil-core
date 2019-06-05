'use strict';

const typeforce = require('typeforce');
const assert = require('assert');
const types = require('../types');

const BaseConciliumDefinition = require('./baseConciliumDefinition');

//--------------- Witness concilium definition ---------

//const posDef = {
//    parameters: {
//        // see base class
//    },
//
//    // this means - can anybody join concilium or creator should add them
//    isOpen: true,
//
//    // amount to use as share
//    nMinAmountToJoin: 1e8,
//
//    // members information
//    arrMembers: [
//        {
//            pubKey: '324234234',
//            amount: 1e8,
//            nHeightToRelease: 1e4
//        }
//    ]
//};

module.exports = ({Constants}) =>
    class ConciliumPoS extends BaseConciliumDefinition {
        constructor(data) {
            super(data);
            this._setType(BaseConciliumDefinition.CONCILIUM_TYPE_POS);
        }

        getPublicKeys() {
            return this._data.publicKeys.map(pubKey => Buffer.from(pubKey, 'hex'));
        }

        getQuorum() {
            throw new Error('Implement');
        }
    };
