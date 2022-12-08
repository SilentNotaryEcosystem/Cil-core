'use strict';

const typeforce = require('typeforce');
const debugLib = require('debug');

const assert = require('assert');
const types = require('../types');
const {GCD} = require('../utils');

const BaseConciliumDefinition = require('./baseConciliumDefinition');

const debug = debugLib('conciliumPoS:');

//--------------- Witness concilium definition ---------

//const posDef = {
//    parameters: {
//        // see base class
//    },
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
        /**
         *
         * @param {Object} data - posDef see above
         * @param {Number} nSeqLength - length of sequence to be formed for each epoche
         */
        constructor(data, nSeqLength) {
            super(data, nSeqLength);

            assert(data.nMinAmountToJoin, 'Specify nMinAmountToJoin');

            this._setType(BaseConciliumDefinition.CONCILIUM_TYPE_POS);

            if (!Array.isArray(this._data.arrMembers)) this._data.arrMembers = [];

            this._totalSharesAmount = this._data.arrMembers.reduce((accum, m) => accum + m.amount, 0);

            let nGcd = GCD(this._data.arrMembers.map(m => m.amount));
            if (this._totalSharesAmount >= 1e9 && nGcd < 1e6) {
                nGcd = 1e6;
            } else if (this._totalSharesAmount >= 1e6 && nGcd < 1e3) nGcd = 1000;

            this._totalSharesAmount /= nGcd;
            this._arrShares = this._data.arrMembers.map(m => m.amount / nGcd);


            // we need 50% +1
            // as _totalSharesAmount = Sum(amounts) / nGcd
            this._quorum = this._arrShares.length === 1 ?
                1 : (0.5 * this._totalSharesAmount + 1) / this._totalSharesAmount;

            // see _getSlot
            this._paramA = 1289;
            this._paramB = 3559;
        }

        static create(conciliumId, nMinAmountToJoin, currentHeight, arrMembers, nSeqLength) {
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
            }, nSeqLength);

        }

        /**
         * Get wallet addresses of witnesses. Sorted by amount descending
         *
         * @param bConvertToBuffer
         * @returns {(Buffer|*)[]|undefined}
         */
        getAddresses(bConvertToBuffer = true) {
            if (!Array.isArray(this._data.arrMembers)) return undefined;

            return this._data.arrMembers
                .sort((objRecord1, objRecord2) => objRecord2.amount - objRecord1.amount)
                .map(objRecord => bConvertToBuffer ?
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
         * @returns {String}
         */
        getProposerAddress() {
            assert(this._nLocalRound < this._nSeqLength, 'this._nLocalRound exceeded this._nSeqLength');
            const nAddrIdx = this._arrProposers[this._nLocalRound];

            return this._data.arrMembers[nAddrIdx].address;
        }

        /**
         * @see constructor
         *
         * @param strAddress
         * @return {number} It coulnd't be greater than 1!
         */
        getWitnessWeight(strAddress) {
            const nIdx = this._data.arrMembers.findIndex(objMember => objMember.address === strAddress);
            if (!~nIdx) throw new Error(`address: "${strAddress}" not found in concilium`);

            return this._arrShares[nIdx] / this._totalSharesAmount;
        }

        isEnabled() {
            return super.isEnabled() && !!this._data.arrMembers.length;
        }

        initRounds() {
            super.initRounds();

            this._formProposerAddressesSequence(this._nRoundBase);
        }

        getRound() {
            assert(this._nLocalRound !== undefined, 'InitRounds first');

            return this._nRoundBase + this._nLocalRound;
        }

        _findIdxByRound(round) {
            let start = 0;
            round %= this._totalSharesAmount;
            for (let i = 0; i < this._arrShares.length; i++) {
                if (round >= start && round < this._arrShares[i] + start) return i;
                start += this._arrShares[i];
            }

            throw new Error('You aren\'t supposed to be here');
        }

        _formProposerAddressesSequence(seed) {
            typeforce(typeforce.Number, seed);

            this._arrProposers = [];

            for (let i = 0; i < this._nSeqLength; i++) {
                const proposerIdx = this._findIdxByRound(this._getSlot(seed + i));
                this._arrProposers.push(proposerIdx);
            }
        }

        _getSlot(x) {
            return this._paramA * (x) + this._paramB;
        }

        getMembersCount() {
            return this._data.arrMembers.length;
        }
    };
