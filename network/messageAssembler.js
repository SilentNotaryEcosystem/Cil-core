const debug = require("debug")("msgassembler:");

module.exports = (Serializer) =>
    class MessageAssembler {
        constructor() {
            this._messageBuffer=undefined;
        }

        get isDone() {
            return !this._messageBuffer;
        }

        /**
         * There are situations, when one chunk could contain multiple messages!
         *
         * @private
         */
        extractMessages(data) {
            let result;
            if (this.isDone) {
                result = this._start(data);
            } else {
                result = this._continue(data);
            }
            return result.length ? result:null;
        }

        _start(data) {

            // new message, let's assemby it
            let length, dataOffset;
            try {
                ({ length, dataOffset } = Serializer.readMsgLength(data));
            } catch (e) {

                // we are here if message were split in a middle of "length" bytes
                this._postponeData(data);
                return [];
            }

            const firstMsgLength=length + dataOffset;
            if (data.length === firstMsgLength) {

                // exactly one message
                return [data];
            } else if (data.length > firstMsgLength) {

                // we have another message (possibly part of it) in 'data'
                // let's recursively get it
                return [data.slice(0, firstMsgLength)].concat(this._start(data.slice(firstMsgLength)));
            } else if (data.length < firstMsgLength) {

                // we need more chunks
                // store current
                this._postponeData(data);
                return [];
            }
        }

        _continue(data) {
            debug(`   next chunk. length: ${data.length}.`);

            // next chunks for current message
            const concBuff=this._postponeData(data);
            this._messageBuffer=undefined;

            return this._start(concBuff);
        }

        _postponeData(data){
            if(this._messageBuffer){
                this._messageBuffer = Buffer.concat([this._messageBuffer, data]);
            }else{
                this._messageBuffer=Buffer.from(data);
            }

            return this._messageBuffer;
        }
    };
