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

        static create(conciliumId, nMinAmountToJoin, currentHeight, arrMembers) {
            typeforce(
                typeforce.tuple(typeforce.Number, typeforce.Number, typeforce.Number, typeforce.Array),
                arguments
            );

            assert(arrMembers.every(objMember => objMember.pubKey && objMember.amount >= nMinAmountToJoin),
                'Bad arrMembers'
            );

            arrMembers.forEach(
                objMember => objMember.nHeightToRelease = currentHeight + Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON);

            return new this({
                conciliumId,
                nMinAmountToJoin,
                arrMembers,
                isOpen: false
            });

        }

        getPublicKeys() {
            return this._data.publicKeys.map(pubKey => Buffer.from(pubKey, 'hex'));
        }

        getQuorum() {
            throw new Error('Implement');
        }

        /**
         * Redefine this to change proposing behavior
         *
         * @returns {Strings}
         */
        getProposerKey(roundNo) {
            const arrPublicKeys = this.getPublicKeys();
            const idx = roundNo % arrPublicKeys.length;
            return arrPublicKeys[idx];
        }

        getWitnessWeight() {
            throw new Error('Implement');
        }
    };
