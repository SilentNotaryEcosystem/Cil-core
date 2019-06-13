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
//            address: '324234234',
//            amount: 1e8,
//            nHeightToRelease: 1e4
//        }
//    ]
//};

module.exports = ({Constants}) =>
    class ConciliumPoS extends BaseConciliumDefinition {
        constructor(data) {
            super(data);

            assert(data.nMinAmountToJoin, 'Specify nMinAmountToJoin');

            this._setType(BaseConciliumDefinition.CONCILIUM_TYPE_POS);
        }

        static create(conciliumId, nMinAmountToJoin, currentHeight, arrMembers) {
            typeforce(
                typeforce.tuple(typeforce.Number, typeforce.Number, typeforce.Number, typeforce.Array),
                arguments
            );

            assert(arrMembers.every(objMember => objMember.address && objMember.amount >= nMinAmountToJoin),
                'Bad arrMembers'
            );

            arrMembers.forEach(
                objMember => objMember.nHeightToRelease = currentHeight + Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON);

            return new this({
                conciliumId,
                nMinAmountToJoin,
                arrMembers,
                isOpen: !arrMembers.length
            });

        }

        getAddresses(bConvertToBuffer = true) {
            return this._data.arrMembers.map(objRecord => bConvertToBuffer ?
                Buffer.from(objRecord.address, 'hex') : objRecord.address);
        }

        getQuorum() {
            throw new Error('Implement');
        }

        /**
         * Redefine this to change proposing behavior
         *
         * @returns {Strings}
         */
        getProposerAddress(roundNo) {
            throw new Error('Implement');
        }

        getWitnessWeight() {
            throw new Error('Implement');
        }
    };
