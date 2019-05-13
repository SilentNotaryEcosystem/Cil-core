const typeforce = require('typeforce');
const types = require('../../types');

const BLOCK_HASH = typeforce.oneOf(typeforce.BufferN(32), typeforce.BufferN(6));

/**
 *
 * @param {Object} Constants
 * @param {Crypto} Crypto
 * @param {WitnessMessageCommon} WitnessMessageCommon
 * @param {Object} WitnessBlockVoteProto - protobuf compiled Message prototype
 * @return {{new(*): WitnessMessageBlockAck}}
 */
module.exports = (Constants, Crypto, WitnessMessageCommon, WitnessBlockVoteProto) => {
    const {MSG_WITNESS_BLOCK_VOTE} = Constants.messageTypes;

    return class WitnessMessageBlockAck extends WitnessMessageCommon {
        constructor(data) {

            super(data);
            if (data instanceof WitnessMessageCommon || Buffer.isBuffer(super.content)) {
                this._data = {...WitnessBlockVoteProto.decode(super.content)};

                if (!this.isWitnessBlockVote()) {
                    throw new Error(`Wrong message type. Expected "${MSG_WITNESS_BLOCK_VOTE}" got "${this.message}"`);
                }
            } else {
                if (!data.blockHash) {
                    throw new Error('Specify "blockHash"');
                }

                // it could be hash256 or 'reject'
                typeforce(BLOCK_HASH, data.blockHash);

                this._data = {
                    blockHash: data.blockHash,
                    signature: null
                };

            }
            this.message = MSG_WITNESS_BLOCK_VOTE;
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

        static reject(conciliumId) {
            return new this({conciliumId, blockHash: Buffer.from('reject')});
        }

        sign(privateKey) {

            // sign blockHash
            if (!this.blockHash) throw new Error('Set blockHash first!');
            typeforce(BLOCK_HASH, this.blockHash);
            this._data.signature = Crypto.sign(this.blockHash, privateKey);

            // sign entire message @see msgCommon.sign (it will call this.encode)
            super.sign(privateKey);
        }

        encode() {
            super.content = WitnessBlockVoteProto.encode(this._data).finish();
            return super.encode();
        }

    };
};
