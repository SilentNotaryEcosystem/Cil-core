const {BufferReader} = require("protobufjs");

module.exports = MessagesImplementation => {
    const {MsgCommon, MsgVersion} = MessagesImplementation;
    return class Serializer {
        /**
         *
         * @param {MessageCommon} message - to send to network
         * @return {Buffer}
         */
        static serialize(message) {
            return message.encode();
        }

        /**
         *
         * @param {Buffer} buffer - to decode
         * @param {Boolean} toCommon - when MessageCommon will be enough
         * @return {Object}
         */
        static deSerialize(buffer, toCommon = false) {
            // was message completly downloaded?
            const buffReader = new BufferReader(buffer);
            const length = buffReader.int32();
            if (buffer.length - buffReader.pos !== length) {
                throw new Error(`Buffer length ${buffer.length} not equal to expected ${length}`);
            }

            // first we should decide type of message
            const msg = new MsgCommon(buffer);
            if (toCommon) return msg;

            // now return properly deserialized message
            if (msg.isVersion) return new MsgVersion(buffer);
            if (msg.isVerAck) return msg;
            if (msg.isGetAddr) return msg;
        }
    };
};
