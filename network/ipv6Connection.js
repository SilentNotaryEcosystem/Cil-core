const EventEmitter = require('events');
const debug = require('debug')('transport:connection');

const {sleep} = require('../utils');

/**

 */


module.exports = (Serializer, MessageAssembler, Transport, Constants) =>
    class Connection extends EventEmitter {
        constructor(options) {
            super();

            this._timeout = options.timeout || Constants.CONNECTION_TIMEOUT;
            this._socket = options.socket;

            if (!this._socket) throw new Error('No socket!');
            //            this._socket.write = util.promisify(this._socket.write);

            this._nonce = parseInt(Math.random() * 10000);
            this._socket.on('data', this._incomingMessage.bind(this));
            this._socket.on('end', this.close.bind(this));
            this._socket.on('error', this.close.bind(this));

            this._messageAssembler = new MessageAssembler;
        }

        /**
         *
         * @return {String} !!
         */
        get remoteAddress() {
            return this._socket.remoteAddress;
        }

        /**
         *
         * @return {Number} !!
         */
        get remotePort() {
            return this._socket.remotePort;
        }

        /**
         *
         * @param {MsgCommon} message - message to send to peer
         */
        async sendMessage(message) {
            debug(`(Nonce: ${this._nonce}) sendMessage "${message.message}"`);
            return this._socket.write(Serializer.serialize(message));
        }

        async _incomingMessage(data) {
            const arrMessages = this._messageAssembler.extractMessages(data);

            // incomplete message
            if (!arrMessages) return;

            let msgBuffer;
            while ((msgBuffer = arrMessages.shift())) {
                try {
                    const msg = Serializer.deSerialize(msgBuffer);
                    debug(`(Nonce: ${this._nonce}) incomingMessage: "${msg.message}". Done`);
                    this.emit('message', msg);

                    // for receiveSync only.
                    this.emit('messageSync', msg);
                } catch (err) {
                    err.log();
                    this.close();
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
            this._socket.destroy();
            this.emit('close');
        }
    };
