/**
 *
 * @param {Object} Constants
 * @param {Object} MessageCommon
 * @param {Object} VersionPayloadProto - protobuf compiled VersionPayload prototype
 * @return {{new(*): MessageVersion}}
 */
module.exports = (Constants, MessageCommon, VersionPayloadProto) =>

    class MessageVersion extends MessageCommon {

        /**
         *
         * @param {Object|Buffer} data
         * @param {Number} data.protocolVersion - current protocol version
         * @param {Object} data.peerInfo - @see network.proto.PeerInfo
         * @param {Number} data.height - curent DB height (length of MainChain)
         */
        constructor(data) {

            if (Buffer.isBuffer(data)) {
                super(data);
                if (this.message !== 'version') {
                    throw new Error(`Wrong message type. Expected 'version' got '${this.message}'`);
                }

                this._data = {...VersionPayloadProto.decode(this.payload)};
                // TODO: free this.message.payload after decode to reduce memory usage
            } else {
                super();
                if (typeof data === 'object') {
                    if (!data.nonce) throw new Error('You should specify nonce!');

                    const errMsg = VersionPayloadProto.verify(data);
                    if (errMsg) throw new Error(errMsg);

                    const payload = VersionPayloadProto.create(data);
                    this._data = {
                        ...payload,
                        timeStamp: parseInt(Date.now() / 1000),
                        protocolVersion: Constants.protocolVersion
                    };
                }
                this.message = 'version';
            }
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
