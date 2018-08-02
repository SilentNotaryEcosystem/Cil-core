const EventEmitter = require('events');
const {BufferReader} = require("protobufjs");

const {sleep} = require('../utils');

/**
 * Это тестовый транспорт Socket'ах.
 * Нужно фактически заменить path на address для обычного TCP/IP
 * Может эмулировать задержку через options.delay
 */


module.exports = (Serializer, Constants) =>
    class TestConnection extends EventEmitter {
        constructor(options) {
            super();

            this._timeout = options.timeout || Constants.CONNECTION_TIMEOUT;
            this._delay = options.delay !== undefined ? options.delay : parseInt(Math.random() * 10 * 1000);
            this._socket = options.socket;
            if (!this._socket) throw new Error('No socket!');

            this._messageBuffer = undefined;
            this._socket.on('data', this._incomingMessage.bind(this));
        }

        get myAddress() {
            return this._topic;
        }

        get remoteAddress() {
            return this._topic;
        }

        /**
         *
         * @param {MsgCommon} message - message to send to peer
         */
        async sendMessage(message) {
            if (this._delay) await sleep(this._delay);
            logger.info(`sendMessage delay ${this._delay}`);
            this._socket.write(Serializer.serialize(message));
        }

        async _incomingMessage(data) {

            if (!this._messageBuffer) {

                // new message, let's assemby it
                const buffReader = new BufferReader(data);
                this._msgLength = buffReader.int32();
                logger.info(`New message. Total length: ${this._msgLength}`);
                this._messageBuffer = Buffer.alloc(this._msgLength + buffReader.pos);
                data.copy(this._messageBuffer);
                this._offset = data.length;
            } else {

                // next chunks for current message
                data.copy(this._messageBuffer, this._offset);
                this._offset += data.length;
            }
            logger.info(`_incomingData chunkLength: ${data.length} delay ${this._delay}`);
            if (this._msgLength <= this._offset) {
                logger.info(`Done with message`);

                // whole message buffered, we'r done
                if (this._delay) await sleep(this._delay);
                try {
                    this.emit('message', Serializer.deSerialize(this._messageBuffer));
                } catch (err) {
                    logger.error(err);
                }

                // clear state
                this._messageBuffer = undefined;
            }
        }

        /**
         *
         * @return {Promise<MsgCommon | undefined>} - message | undefined if timeout reached
         */
        receiveSync() {
            const prom = new Promise(resolve => {
                this.once('message', async objMessage => {
                    resolve(objMessage);
                });
            });
            return Promise.race([prom, sleep(this._timeout)]);
        }

        close() {
            this._socket.end();
            this.emit('close');
        }

    };
