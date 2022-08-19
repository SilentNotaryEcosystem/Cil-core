const typeforce = require('typeforce');

/**
 * Scenario:
 * - Decode MessageCommon from wire
 * - Detect signature
 * - Decode WitnessMessageCommon from MessageCommon
 * - Get conciliumId from WitnessMessageCommon and pass it to respective BFT
 * - Decode specific Witness msg from WitnessMessageCommon
 *
 * @param {Object} Constants
 * @param {CryptoLib} Crypto
 * @param {MessageCommon} MessageCommon
 * @param {Object} WitnessMessageProto - protobuf compiled Message prototype
 * @return {{new(*): WitnessMessageCommon}}
 */
module.exports = (Constants, Crypto, MessageCommon, WitnessMessageProto) => {
    const {
        MSG_WITNESS_NEXT_ROUND,
        MSG_WITNESS_EXPOSE,
        MSG_WITNESS_BLOCK,
        MSG_WITNESS_HANDSHAKE,
        MSG_WITNESS_BLOCK_VOTE
    } = Constants.messageTypes;

    return class WitnessMessageCommon extends MessageCommon {

        constructor(data) {
            if (data instanceof WitnessMessageCommon) {
                super(data);

                // invoked from descendant classes via super()
                // copy content (it's not deep copy, possibly better use encode/decode)
                this._msgData = Object.assign({}, data._msgData);
            } else if (Buffer.isBuffer(data)) {
                super(data);

                // this.payload filled with super(date) (NOTE we'r parsing THIS.payload)
                this._msgData = {...WitnessMessageProto.decode(this.payload)};
            } else if (data instanceof MessageCommon) {
                super(data);

                // we received it from wire (NOTE we'r parsing data.payload)
                this._msgData = {...WitnessMessageProto.decode(data.payload)};
            } else {
                super();

                // constructing it manually
                if (data.conciliumId === undefined) {
                    throw new Error('Specify "conciliumId"');
                }
                this._msgData = {
                    conciliumId: data.conciliumId
                };
            }
        }

        get conciliumId() {
            return this._msgData.conciliumId;
        }

        get content() {
            return this._msgData.content;
        }

        /**
         * used for encoding by descendants
         *
         * @param {Buffer} value
         * @return {*}
         */
        set content(value) {
            typeforce('Buffer', value);

            this._msgData.content = value;
        }

        set handshakeMessage(unused) {
            this.message = MSG_WITNESS_HANDSHAKE;
        }

        encode() {
            this.payload = WitnessMessageProto.encode(this._msgData).finish();
            return super.encode();
        }

        isHandshake() {
            return this.message === MSG_WITNESS_HANDSHAKE;
        }

        isNextRound() {
            return this.message === MSG_WITNESS_NEXT_ROUND;
        }

        isExpose() {
            return this.message === MSG_WITNESS_EXPOSE;
        }

        isWitnessBlock() {
            return this.message === MSG_WITNESS_BLOCK;
        }

        isWitnessBlockVote() {
            return this.message === MSG_WITNESS_BLOCK_VOTE;
        }
    };
};
