const EventEmitter = require('events');
const util = require('util');
const debug = require('debug')('transport:connection');

const {sleep} = require('../utils');

/**
 * Это тестовый транспорт Socket'ах.
 * Нужно фактически заменить path на address для обычного TCP/IP
 * Может эмулировать задержку через options.delay
 */


module.exports = (Serializer, MessageAssembler, Transport, Constants) =>
    class Connection extends EventEmitter {
        constructor(options) {
            super();

            this._timeout = options.timeout || Constants.CONNECTION_TIMEOUT;
            this._delay = options.delay !== undefined ? options.delay : parseInt(Math.random() * 10 * 1000);
            this._socket = options.socket;
            if (!this._socket) throw new Error('No socket!');
//            this._socket.write = util.promisify(this._socket.write);

            this._nonce = parseInt(Math.random() * 10000);
            this._socket.on('data', this._incomingMessage.bind(this));

            this._messageAssembler = new MessageAssembler;
        }

        get myAddress() {
            return this._socket.localAddress;
        }

        /**
         *
         * @return {Buffer} !!
         */
        get remoteAddress() {
            // Prod implementation
//            return this._socket.remoteAddress;
            // implementation for testConnection with UNIX sockets
            return this._socket.remoteAddress ? this._socket.remoteAddress : Connection.strToAddress('undefinedRemote');
        }

        /**
         *
         * @param {MsgCommon} message - message to send to peer
         */
        async sendMessage(message) {
            if (this._delay) await sleep(this._delay);
            debug(`(Nonce: ${this._nonce}, delay ${this._delay}) sendMessage "${message.message}"`);
            const result = this._socket.write(Serializer.serialize(message));
            return result;
        }

        async _incomingMessage(data) {
            const arrMessages = this._messageAssembler.extractMessages(data);

            // incomplete message
            if (!arrMessages) return;

            let msgBuffer;
            while ((msgBuffer = arrMessages.shift())) {
                try {
                    const msg = Serializer.deSerialize(msgBuffer);
                    debug(`(Nonce: ${this._nonce}, delay ${this._delay}) incomingMessage: "${msg.message}". Done`);
                    if (this._delay) await sleep(this._delay);
                    this.emit('message', msg);

                    // for receiveSync only.
                    this.emit('messageSync', msg);
                } catch (err) {
                    logger.error(err);
                }
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

        /**
         * DON'T implement in prod connection
         *
         * Return at least 16 bytes (length of ipv6 address) buffer created from address
         * If needed it will be padded with 0 from start
         * Will be replaced with real ipv6 buffer
         *
         * @param {String} address
         * @return {Buffer}
         */
        static strToAddress(address) {
            const buffer = Buffer.from(address);
            const bytestoPadd = buffer.length > 16 ? 0 : 16 - buffer.length;
            return bytestoPadd ? Buffer.concat([Buffer.alloc(bytestoPadd), buffer]) : buffer;
        }

    };
