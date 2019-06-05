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
//    publicKeys: [
//    ],
//    quorum: 1 | publicKeys.length*2/3
//};

module.exports = ({Constants}) =>
    class ConciliumRrDefinition extends BaseConciliumDefinition {
        constructor(data) {
            super(data);

            this._setType(BaseConciliumDefinition.CONCILIUM_TYPE_RR);
        }

        static create(conciliumId, arrPublicKeys, quorum) {
            typeforce(typeforce.tuple('Number', 'Array'), arguments);

            return new this({
                publicKeys: arrPublicKeys,
                conciliumId,
                quorum
            });
        }

        /**
         *
         * @return {Array<Buffer>}
         */
        getPublicKeys() {
            return this._data.publicKeys.map(pubKey => Buffer.from(pubKey, 'hex'));
        }

        setQuorum(quorum) {
            this._data.quorum = quorum;
        }

        getQuorum() {
            if (this._data.quorum) return this._data.quorum;
            const arr = this._data.delegatesPublicKeys || this._data.publicKeys;
            return parseInt(arr.length / 2) + 1;
        }

        toObject() {
            return this._data;
        }
    };
