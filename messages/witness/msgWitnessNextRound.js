/**
 * Scenario:
 * - Decode MessageCommon from wire
 * - Detect signature
 * - Decode WitnessMessageCommon from MessageCommon
 * - Get groupName from WitnessMessageCommon and pass it to respective BFT
 * - Decode specific Witness msg from WitnessMessageCommon
 *
 * @param {Object} Constants
 * @param {CryptoLib} Crypto
 * @param {WitnessMessageCommon} WitnessMessageCommon
 * @param {Object} WitnessNextRoundProto - protobuf compiled Message prototype
 * @return {{new(*): WitnessMessageCommon}}
 */
module.exports = (Constants, Crypto, WitnessMessageCommon, WitnessNextRoundProto) => {
    const {MSG_WITNESS_NEXT_ROUND} = Constants.messageTypes;

    return class WitnessNextRound extends WitnessMessageCommon {

        constructor(data) {
            super(data);

            if (data instanceof WitnessMessageCommon || Buffer.isBuffer(this.content)) {
                this._data = {...WitnessNextRoundProto.decode(this.content)};

                if (!this.isNextRound()) {
                    throw new Error(`Wrong message type. Expected "${MSG_WITNESS_NEXT_ROUND}" got "${this.message}"`);
                }
            } else {
                if (!data.roundNo) {
                    throw new Error('Specify "roundNo"');
                }

                this._data = {
                    roundNo: data.roundNo
                };
            }
            this.message = MSG_WITNESS_NEXT_ROUND;
        }

        parseContent(value) {
            this._data = {...WitnessNextRoundProto.decode(value)};
        }

        get roundNo() {
            return this._data.roundNo;
        }

        encode() {
            super.content = WitnessNextRoundProto.encode(this._data).finish();
            return super.encode();
        }
    };
};
