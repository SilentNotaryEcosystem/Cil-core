'use strict';

const typeforce = require('typeforce');
const types = require('../types');

module.exports = (factory, {witnessGroupDefinitionProto}) =>
    class WitnessGroupDefinition {
        constructor(data) {
            if (Buffer.isBuffer(data)) {
                this._data = {...witnessGroupDefinitionProto.decode(data)};
            } else if (typeof data === 'object') {
                const errMsg = witnessGroupDefinitionProto.verify(data);
                if (errMsg) throw new Error(`WitnessGroupDefinition: ${errMsg}`);

                // we store publicKeys as buffers!
                for (let i in data.publicKeys) {
                    if (!Buffer.isBuffer(data.publicKeys[i])) {
                        data.publicKeys[i] = Buffer.from(data.publicKeys[i], 'hex');
                    }
                }
                this._data = witnessGroupDefinitionProto.create(data);
            } else {
                throw new Error('Contsruct from Buffer|Object');
            }
        }

        static create(groupName, groupId, arrPublicKeys) {
            typeforce(typeforce.tuple('String', 'Number', 'Array'), arguments);

            return new this({
                publicKeys: arrPublicKeys,
                groupName,
                groupId
            });
        }

        getPublicKeys() {
            return this._data.publicKeys;
        }

        getGroupName() {
            return this._data.groupName;
        }

        getGroupId() {
            return this._data.groupId;
        }

        getQuorum() {
            return !this._data.quorum ? parseInt(this._data.publicKeys.length / 2) + 1 : this._data.quorum;
        }
    };
