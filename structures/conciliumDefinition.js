'use strict';

const typeforce = require('typeforce');
const assert = require('assert');
const v8 = require('v8');
const types = require('../types');

module.exports = ({Constants}, {conciliumDefinitionProto, conciliumParametersProto}) =>
    class ConciliumDefinition {
        constructor(data) {
            if (Buffer.isBuffer(data)) {
                this._data = v8.deSerialize(data);
            } else if (typeof data === 'object') {
                const errMsg = conciliumDefinitionProto.verify(data);
                if (errMsg) throw new Error(`ConciliumDefinition: ${errMsg}`);

                // we store publicKeys as buffers!
                assert(data.publicKeys.length, 'No keys in concilium definition!');
                for (let i in data.publicKeys) {
                    if (!Buffer.isBuffer(data.publicKeys[i])) {
                        data.publicKeys[i] = Buffer.from(data.publicKeys[i], 'hex');
                    }
                }
                for (let i in data.delegatesPublicKeys) {
                    if (!Buffer.isBuffer(data.delegatesPublicKeys[i])) {
                        data.delegatesPublicKeys[i] = Buffer.from(data.delegatesPublicKeys[i], 'hex');
                    }
                }

                // if delegatesPublicKeys omitted - all of participants are delegates
                if (!data.delegatesPublicKeys) data.delegatesPublicKeys = data.publicKeys;

                this._data = conciliumDefinitionProto.create(data);
            } else {
                throw new Error('Construct from Buffer|Object');
            }
        }

        static create(conciliumId, arrPublicKeys, delegatesPublicKeys, quorum) {
            typeforce(typeforce.tuple('Number', 'Array'), arguments);

            return new this({
                publicKeys: arrPublicKeys,
                conciliumId,
                delegatesPublicKeys: delegatesPublicKeys || arrPublicKeys,
                quorum
            });
        }

        /**
         *
         * @param {Object} objContractData - contract data, now {_arrConciliums: []}
         * @returns {Array} of ConciliumDefinition
         */
        static getFromContractData(objContractData) {
            const {_arrConciliums} = objContractData;
            return _arrConciliums.map(objDefData => new this(objDefData));
        }

        getPublicKeys() {
            return this._data.publicKeys;
        }

        getDelegatesPublicKeys() {
            return this._data.delegatesPublicKeys;
        }

        getConciliumId() {
            return this._data.conciliumId;
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

        getFeeTxSize() {
            return this._data.parameters ? this._data.parameters.feeTxSize : undefined;
        }

        getContractCreationFee() {
            return this._data.parameters ? this._data.parameters.feeContractCreation : undefined;
        }

        getContractInvocationFee() {
            return this._data.parameters ? this._data.parameters.feeContractInvocation : undefined;
        }
    };
