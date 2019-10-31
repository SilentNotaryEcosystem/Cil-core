'use strict';

const typeforce = require('typeforce');
const assert = require('assert');
const types = require('../types');

const BaseConciliumDefinition = require('./baseConciliumDefinition');

//--------------- Witness concilium definition ---------

//const closedRR = {
//    parameters: {
//        // see base class
//    },
//
//    // members information
//    addresses: [
//    ],
//    quorum: 1 | addresses.length*2/3
//};

module.exports = ({Constants}) =>
    class ConciliumRrDefinition extends BaseConciliumDefinition {
        constructor(data) {
            super(data, data.addresses ? data.addresses.length : 1);

            this._setType(BaseConciliumDefinition.CONCILIUM_TYPE_RR);
            if (!Array.isArray(this._data.addresses)) this._data.addresses = [];
        }

        static create(conciliumId, arrAddresses, quorum) {
            typeforce(typeforce.tuple('Number', 'Array'), arguments);

            return new this({
                addresses: arrAddresses,
                conciliumId,
                quorum
            });
        }

        /**
         *
         * @return {Array<Buffer>}
         */
        getAddresses(bConvertToBuffer = true) {
            if (!Array.isArray(this._data.addresses)) return undefined;
            return this._data.addresses.map(addr => bConvertToBuffer ? Buffer.from(addr, 'hex') : addr.toString('hex'));
        }

        setQuorum(quorum) {
            this._data.quorum = quorum;
        }

        getQuorum() {
            if (this._data.quorum) return this._data.quorum;
            const arr = this._data.addresses;
            return parseInt(arr.length / 2) + 1;
        }

        toObject() {
            return this._data;
        }

        /**
         * Redefine this to change proposing behavior
         *
         * @returns {String}
         */
        getProposerAddress(roundNo) {
            const arrAddresses = this.getAddresses();
            const idx = roundNo % arrAddresses.length;
            return arrAddresses[idx].toString('hex');
        }

        getWitnessWeight(strAddress) {
            return 1;
        }

        isEnabled() {
            return super.isEnabled() && !!this._data.addresses.length;
        }

        getRound() {
            assert(this._nLocalRound !== undefined, 'InitRounds first');

            return this._nRoundBase + this._nLocalRound;
        }

        getMembersCount() {
            return this._data.addresses.length;
        }
    };
