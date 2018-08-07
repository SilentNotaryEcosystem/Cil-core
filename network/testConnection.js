const EventEmitter = require('events');
const util = require('util');
const debug = require('debug')('transport:connection');

const {sleep} = require('../utils');

/**
 * Это тестовый транспорт Socket'ах.
 * Нужно фактически заменить path на address для обычного TCP/IP
 * Может эмулировать задержку через options.delay
 */


module.exports = (Serializer, Constants) =>
    class Connection extends EventEmitter {
        constructor(options) {
            super();

            this._timeout = options.timeout || Constants.CONNECTION_TIMEOUT;
            this._delay = options.delay !== undefined ? options.delay : parseInt(Math.random() * 10 * 1000);
            this._socket = options.socket;
            if (!this._socket) throw new Error('No socket!');
            this._socket.write = util.promisify(this._socket.write);

            this._nonce = parseInt(Math.random() * 10000);
            this._messageBuffer = undefined;
            this._socket.on('data', this._incomingMessage.bind(this));
        }

        get myAddress() {
            return this._socket.localAddress;
        }

        get remoteAddress() {
            return this._socket.remoteAddress;
        }

        /**
         *
         * @param {MsgCommon} message - message to send to peer
         */
        async sendMessage(message) {
            if (this._delay) await sleep(this._delay);
            debug(`(Nonce: ${this._nonce}, delay ${this._delay}) sendMessage "${message.message}"`);
            return await this._socket.write(Serializer.serialize(message));
        }

        async _incomingMessage(data) {

            if (!this._messageBuffer) {

                // new message, let's assemby it
                const {length, dataOffset} = Serializer.readMsgLength(data);
                this._msgLength = length;
                debug(
                    `(Nonce: ${this._nonce}, delay ${this._delay}) incomingMessage. Total length: ${this._msgLength}`);
                this._messageBuffer = Buffer.alloc(this._msgLength + dataOffset);
                data.copy(this._messageBuffer);
                this._offset = data.length;
            } else {

                // next chunks for current message
                data.copy(this._messageBuffer, this._offset);
                this._offset += data.length;
            }
            debug(`(Nonce: ${this._nonce}, delay ${this._delay}) --- chunkLength: ${data.length}`);
            if (this._msgLength <= this._offset) {
                debug(`(Nonce: ${this._nonce}, delay ${this._delay}) incomingMessage. Done`);

                // whole message buffered, we'r done
                if (this._delay) await sleep(this._delay);
                try {
                    const msg = Serializer.deSerialize(this._messageBuffer);
                    this.emit('message', msg);
                    this.emit('messageSync', msg);
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
                this.once('messageSync', async objMessage => {
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
