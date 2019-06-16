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

            if (!Array.isArray(this._data.arrMembers)) this._data.arrMembers = [];
            this._totalAmount = this._data.arrMembers.reduce((accum, objMember) => accum + objMember.amount, 0);
            this._quorum = (0.5 * this._totalAmount + 1) / this._totalAmount;
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
                Buffer.from(objRecord.address, 'hex') : objRecord.address.toString('hex'));
        }

        /**
         * @see constructor
         *
         * @return {number} It coulnd't be greater than 1!
         */
        getQuorum() {
            return this._quorum;
        }

        /**
         * Redefine this to change proposing behavior
         *
         * @returns {Strings}
         */
        getProposerAddress(roundNo) {

            // TODO: REPLACE THIS STUB!!
            const arrAddresses = this.getAddresses();
            const idx = roundNo % arrAddresses.length;
            return arrAddresses[idx].toString('hex');
        }

        /**
         * @see constructor
         *
         * @param strAddress
         * @return {number} It coulnd't be greater than 1!
         */
        getWitnessWeight(strAddress) {
            const objMember = this._data.arrMembers.find(objMember => objMember.address === strAddress);
            if (!objMember) throw new Error(`address: "${strAddress}" not found in concilium`);

            return objMember.amount / this._totalAmount;
        }

        isEnabled() {
            return super.isEnabled() && !!this._data.arrMembers.length;
        }
    };
