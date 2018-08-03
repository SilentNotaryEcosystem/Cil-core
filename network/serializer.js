const {BufferReader} = require("protobufjs");

module.exports = MessagesImplementation => {
    const {MsgCommon, MsgVersion, MsgAddr} = MessagesImplementation;
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
            const {length, dataOffset} = Serializer.readMsgLength(buffer);
            if (buffer.length - dataOffset !== length) {
                throw new Error(`Buffer length ${buffer.length} not equal to expected ${length}`);
            }

            // first we should decide type of message
            const msg = new MsgCommon(buffer);
            if (toCommon) return msg;

            // now return properly deserialized message
            if (msg.isVersion()) return new MsgVersion(buffer);
            if (msg.isVerAck()) return msg;
            if (msg.isGetAddr()) return msg;
            if (msg.isAddr()) return new MsgAddr(buffer);
        }

        /**
         *
         * @param {Buffer} firstChunk - first chunk (or whole) of serialized data
         * @return {{length: number, dataOffset: number}} length - data length, dataOffset - position of payload in chunk
         */
        static readMsgLength(firstChunk) {
            const buffReader = new BufferReader(firstChunk);
            return {length: buffReader.int32(), dataOffset: buffReader.pos};
        }
    };
};
