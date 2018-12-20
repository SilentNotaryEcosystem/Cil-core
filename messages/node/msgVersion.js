/**
 *
 * @param {Object} Constants
 * @param {Object} MessageCommon
 * @param {Object} VersionPayloadProto - protobuf compiled VersionPayload prototype
 * @return {{new(*): MessageVersion}}
 */
module.exports = (Constants, MessageCommon, VersionPayloadProto) => {
    const {MSG_VERSION} = Constants.messageTypes;

    return class MessageVersion extends MessageCommon {

        /**
         *
         * @param {Object|Buffer|MessageCommon} data
         * @param {Number} data.protocolVersion - current protocol version
         * @param {Object} data.peerInfo - @see network.proto.PeerInfo
         * @param {Number} data.height - curent DB height (length of MainChain)
         */
        constructor(data) {
            if (!data) throw new Error('You should pass data to constructor');
            if (data instanceof MessageCommon || Buffer.isBuffer(data)) {
                super(data);
                if (!this.isVersion()) {
                    throw new Error(`Wrong message type. Expected "${MSG_VERSION}" got "${this.message}"`);
                }

                this._data = {...VersionPayloadProto.decode(this.payload)};
                // TODO: free this.message.payload after decode to reduce memory usage
            } else {
                super();
                if (typeof data === 'object') {
                    if (!data.nonce) throw new Error('You should specify nonce!');

                    const errMsg = VersionPayloadProto.verify(data);
                    if (errMsg) throw new Error(`MessageVersion: ${errMsg}`);

                    const payload = VersionPayloadProto.create(data);
                    this._data = {
                        ...payload,
                        timeStamp: parseInt(Date.now() / 1000),
                        protocolVersion: Constants.protocolVersion
                    };
                }
                this.message = MSG_VERSION;
            }
        }

        get nonce() {
            return this._data.nonce;
        }

        get data() {
            return this._data;
        }

        get protocolVersion() {
            return this._data.protocolVersion;
        }

        get peerInfo() {
            return this._data.peerInfo;
        }

        get msecTime() {
            return 1000 * this._data.timeStamp;
        }
        /**
         * ATTENTION! for payload we'll use encode NOT encodeDelimited as for entire Message
         *
         * @return {Uint8Array}
         */
        encode() {
            this.payload = VersionPayloadProto.encode(this._data).finish();
            return super.encode();
        }
    };
};
