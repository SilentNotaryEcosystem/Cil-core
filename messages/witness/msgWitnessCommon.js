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
        MSG_WITNESS_BLOCK_ACK,
        MSG_WITNESS_BLOCK_REJECT
    } = Constants.messageTypes;

    return class WitnessMessageCommon extends MessageCommon {

        constructor(data) {
            if (data instanceof WitnessMessageCommon) {
                super(data);

                // invoked from descendant classes via super()
                // lets copy content
                this._msgData = Object.assign({}, data._msgData);
            } else if (Buffer.isBuffer(data)) {
                super(data);

                // this.payload filled with super(date)
                this._msgData = {...WitnessMessageProto.decode(this.payload)};
            } else if (data instanceof MessageCommon || Buffer.isBuffer(data)) {
                super(data);

                // we received it from wire
                this._msgData = {...WitnessMessageProto.decode(data.payload)};
            } else {
                super();

                // constructing it manually
                if (!data.groupName) {
                    throw new Error('Specify "groupName"');
                }
                this._msgData = {
                    groupName: data.groupName
                };
            }
        }

        get groupName() {
            return this._msgData.groupName;
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
            return this._msgData.content = value;
        }

        set handshakeMessage(unused) {
            this.message = MSG_WITNESS_HANDSHAKE;
            this.content = Buffer.from(this.groupName);
        }

        set blockRejectMessage(unused) {
            this.message = MSG_WITNESS_BLOCK_REJECT;
            this.content = Buffer.from('reject');
        }

        parseContent(value) {
            throw new Error('You should implement this method!');
        }

        encode() {
            this.payload = WitnessMessageProto.encode(this._msgData).finish();
            return super.encode();
        }

        isHandshake() {
            if (this.message === MSG_WITNESS_HANDSHAKE && this.groupName !== '' + this.content) {
                throw new TypeError(`Malformed "${MSG_WITNESS_HANDSHAKE}"`);
            }
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

        isWitnessBlockAccept() {
            return this.message === MSG_WITNESS_BLOCK_ACK;
        }

        isWitnessBlockReject() {
            if (this.message === MSG_WITNESS_BLOCK_REJECT && 'reject' !== '' + this.content) {
                throw new TypeError(`Malformed "${MSG_WITNESS_BLOCK_REJECT}"`);
            }
            return this.message === MSG_WITNESS_BLOCK_REJECT;
        }

    };
};
