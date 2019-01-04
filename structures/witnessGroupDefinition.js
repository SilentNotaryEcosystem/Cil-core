'use strict';

const typeforce = require('typeforce');
const assert = require('assert');
const v8 = require('v8');
const types = require('../types');

module.exports = (factory, {witnessGroupDefinitionProto}) =>
    class WitnessGroupDefinition {
        constructor(data) {
            if (Buffer.isBuffer(data)) {
                this._data = v8.deSerialize(data);
            } else if (typeof data === 'object') {
                const errMsg = witnessGroupDefinitionProto.verify(data);
                if (errMsg) throw new Error(`WitnessGroupDefinition: ${errMsg}`);

                // we store publicKeys as buffers!
                assert(data.publicKeys.length, 'No keys in group definition!');
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

                this._data = witnessGroupDefinitionProto.create(data);
            } else {
                throw new Error('Construct from Buffer|Object');
            }
        }

        static create(groupId, arrPublicKeys, delegatesPublicKeys, quorum) {
            typeforce(typeforce.tuple('Number', 'Array'), arguments);

            return new this({
                publicKeys: arrPublicKeys,
                groupId,
                delegatesPublicKeys: delegatesPublicKeys || arrPublicKeys,
                quorum
            });
        }

        /**
         *
         * @param {Object} objContractData - contract data, now {_arrGroupDefinitions: []}
         * @returns {Array} of WitnessGroupDefinition
         */
        static getFromContractData(objContractData) {
            const {_arrGroupDefinitions} = objContractData;
            return _arrGroupDefinitions.map(objDefData => new this(objDefData));
        }

        getPublicKeys() {
            return this._data.publicKeys;
        }

        getDelegatesPublicKeys() {
            return this._data.delegatesPublicKeys;
        }

        getGroupId() {
            return this._data.groupId;
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
