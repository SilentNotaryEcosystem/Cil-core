const debug = require('debug')('msgassembler:');

module.exports = Serializer =>
    class MessageAssembler {
        get isDone() {
            return !this._messageBuffer;
        }

        /**
         * There are situations, when one chunk could contain multiple messages!
         *
         * @private
         */
        extractMessages(data) {
            const arrMessagesBuffers = [];
            if (!this._messageBuffer) {
                // new message, let's assemby it
                let objMsgLength;

                try {
                    objMsgLength = Serializer.readMsgLength(data);
                } catch (error) {
                    console.error('msgassembler:serializer:error', data, error);
                    return null;
                }

                const {length, dataOffset} = objMsgLength;

                const totalMsgBufferLength = length + dataOffset;
                debug(`New message. Total length: ${totalMsgBufferLength}. Chunk length: ${data.length}.`);

                const messageBuffer = Buffer.alloc(totalMsgBufferLength);
                const toCopyBytes = data.length > totalMsgBufferLength ? totalMsgBufferLength : data.length;
                data.copy(messageBuffer, 0, 0, toCopyBytes);

                if (data.length === messageBuffer.length) {
                    // exactly one message
                    return [messageBuffer];
                } else if (data.length > messageBuffer.length) {
                    // we have another message (possibly part of it) in 'data'
                    // let's recursively get it
                    arrMessagesBuffers.push(messageBuffer);
                    const subBuffer = data.slice(totalMsgBufferLength);
                    const arrRestOfMessages = this.extractMessages(subBuffer);
                    if (arrRestOfMessages) {
                        return arrMessagesBuffers.concat(arrRestOfMessages);
                    } else {
                        return arrMessagesBuffers;
                    }
                } else if (data.length < messageBuffer.length) {
                    // we need more chunks for it!
                    this._messageBuffer = messageBuffer;
                    this._bytesToGo = messageBuffer.length - data.length;
                    return null;
                }
            } else {
                debug(`   next chunk. length: ${data.length}.`);

                // next chunks for current message
                const toCopyBytes = this._bytesToGo < data.length ? this._bytesToGo : data.length;
                data.copy(this._messageBuffer, this._messageBuffer.length - this._bytesToGo, 0, toCopyBytes);
                if (toCopyBytes === this._bytesToGo) {
                    // we are done with this message
                    arrMessagesBuffers.push(this._messageBuffer);
                    this._messageBuffer = undefined;

                    // no more messages in this chunk
                    if (toCopyBytes === data.length) return arrMessagesBuffers;

                    const subBuffer = data.slice(toCopyBytes);
                    const arrRestOfMessages = this.extractMessages(subBuffer);
                    if (arrRestOfMessages) {
                        return arrMessagesBuffers.concat(arrRestOfMessages);
                    } else {
                        return arrMessagesBuffers;
                    }
                } else {
                    this._bytesToGo -= toCopyBytes;
                    return null;
                }
            }
        }
    };
