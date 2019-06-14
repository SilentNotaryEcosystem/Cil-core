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
//    // this means - can anybody join concilium or creator should add them
//    isOpen: false,
//
//    // members information
//    addresses: [
//    ],
//    quorum: 1 | addresses.length*2/3
//};

module.exports = ({Constants}) =>
    class ConciliumRrDefinition extends BaseConciliumDefinition {
        constructor(data) {
            super(data);

            this._setType(BaseConciliumDefinition.CONCILIUM_TYPE_RR);
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
    };
