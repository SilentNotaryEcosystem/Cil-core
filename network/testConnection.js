const EventEmitter = require('events');
const {sleep} = require('../utils');

/**
 * Это тестовый транспорт на EventEmitter'е (топик в address)
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

            this._topic = options.topic;
            if (!this._topic) throw new Error('No topic!');
            this._socket.on(this._topic, this._incomingMessage.bind(this));

            this._nonse = parseInt(Math.random() * 10000);
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
            this._socket.emit(this._topic, Serializer.serialize(message));
        }

        async _incomingMessage(objMessage) {
            logger.info(`_incomingMessage (nonce: ${this._nonse}) delay ${this._delay}`);
            if (this._delay) await sleep(this._delay);
            try {
                this.emit('message', Serializer.deSerialize(objMessage));
            } catch (err) {
                logger.error(err);
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

    };
