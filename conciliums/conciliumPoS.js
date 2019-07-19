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
        /**
         *
         * @param {Object} data - posDef see above
         * @param {Number} nSeqLength - length of sequence to be formed for each epoche
         */
        constructor(data, nSeqLength = 20) {
            super(data);

            assert(data.nMinAmountToJoin, 'Specify nMinAmountToJoin');

            this._setType(BaseConciliumDefinition.CONCILIUM_TYPE_POS);

            if (!Array.isArray(this._data.arrMembers)) this._data.arrMembers = [];

            const nGcd = GCD(this._data.arrMembers.map(m => m.amount));
            this._arrShares = this._data.arrMembers.map(m => m.amount / nGcd);

            this._totalSharesAmount = this._arrShares.reduce((accum, share) => accum + share, 0);

            // we need 50% +1
            // as _totalSharesAmount = Sum(amounts) / nGcd
            this._quorum = this._arrShares.length === 1 ?
                1 : (0.5 * this._totalSharesAmount + 1) / this._totalSharesAmount;

            this._nSeqLength = nSeqLength;

            // see _getSlot
            this._paramA = 7;
            this._paramB = 17;
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

        getAddresses(bConvertToBuffer = true) {
            if (!Array.isArray(this._data.arrMembers)) return undefined;

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
         * @returns {String}
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
            const nIdx = this._data.arrMembers.findIndex(objMember => objMember.address === strAddress);
            if (!~nIdx) throw new Error(`address: "${strAddress}" not found in concilium`);

            return this._arrShares[nIdx] / this._totalSharesAmount;
        }

        isEnabled() {
            return super.isEnabled() && !!this._data.arrMembers.length;
        }

        initRounds() {
            this._nLocalRound = 0;

            // 2 variables, because this._nSeed could change asynchronously
            this._nRoundBase = this._nSeed;
            this._formProposerAddressesSequence(this._nRoundBase);
        }

        getRound() {
            assert(this._nLocalRound !== undefined, 'InitRounds first');

            return this._nRoundBase + this._nLocalRound;
        }

        nextRound() {
            assert(this._nLocalRound !== undefined, 'InitRounds first');

            if (++this._nLocalRound >= this._nSeqLength) this.initRounds();
            return this._nLocalRound;
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
                this._arrProposers.push(this._data.arrMembers[proposerIdx].address);
            }
        }

        _getSlot(x) {
            return this._paramA * (x) + this._paramB;
        }

        getMembersCount() {
            return this._data.arrMembers.length;
        }
    };
