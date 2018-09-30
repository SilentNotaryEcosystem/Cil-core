const typeforce = require('typeforce');
const types = require('../../types');

/**
 *
 * @param {Object} Constants
 * @param {Crypto} Crypto
 * @param {WitnessMessageCommon} WitnessMessageCommon
 * @param {Object} WitnessBlockAckProto - protobuf compiled Message prototype
 * @return {{new(*): WitnessMessageBlockAck}}
 */
module.exports = (Constants, Crypto, WitnessMessageCommon, WitnessBlockAckProto) => {
    const {MSG_WITNESS_BLOCK_ACK} = Constants.messageTypes;

    return class WitnessMessageBlockAck extends WitnessMessageCommon {
        constructor(data) {

            super(data);
            if (data instanceof WitnessMessageCommon || Buffer.isBuffer(super.content)) {
                this._data = {...WitnessBlockAckProto.decode(super.content)};

                if (!this.isWitnessBlockAccept()) {
                    throw new Error(`Wrong message type. Expected "${MSG_WITNESS_BLOCK_ACK}" got "${this.message}"`);
                }
            } else {
                if (!data.blockHash) {
                    throw new Error('Specify "blockHash"');
                }
                typeforce(typeforce.BufferN(32), data.blockHash);

                this._data = {
                    blockHash: data.blockHash,
                    signature: null
                };

            }
            this.message = MSG_WITNESS_BLOCK_ACK;
        }

        get blockHash() {
            return this._data.blockHash;
        }

        get hashSignature() {
            return this._data.signature;
        }

        /**
         * We override it for consensus.processMessage
         * @returns {*}
         */
        get content() {
            return this._data;
        }

        sign(privateKey) {

            // sign blockHash
            if (!this.blockHash) throw new Error('Set blockHash first!');
            typeforce(types.Hash256bit, this.blockHash);
            this._data.signature = Crypto.sign(this.blockHash, privateKey);

            // sign entire message @see msgCommon.sign (it will call this.encode)
            super.sign(privateKey);
        }

        encode() {
            super.content = WitnessBlockAckProto.encode(this._data).finish();
            return super.encode();
        }

    };
};
