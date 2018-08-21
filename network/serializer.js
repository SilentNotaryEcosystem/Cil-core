const {BufferReader} = require("protobufjs");

module.exports = MessagesImplementation => {
    const {MsgCommon} = MessagesImplementation;
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
         * @return {MessageCommon}
         */
        static deSerialize(buffer) {

            // was message completly downloaded?
            const {length, dataOffset} = Serializer.readMsgLength(buffer);
            if (buffer.length - dataOffset !== length) {
                throw new Error(`Buffer length ${buffer.length} not equal to expected ${length}`);
            }

            return new MsgCommon(buffer);
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
