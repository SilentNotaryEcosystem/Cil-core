const EventEmitter = require('events');

const debug = require('debug')('testConnection');
const {sleep} = require('../utils');

/**
 * Это тестовый транспорт на EventEmitter'е (топик в address)
 * Может эмулировать задержку через options.delay
 */

module.exports = Serializer =>
    class TestConnection extends EventEmitter {
        constructor(options) {
            super();

            this._delay = options.delay !== undefined ? options.delay : parseInt(Math.random() * 10 * 1000);
            this._socket = options.socket;
            if (!this._socket) throw new Error('No socket!');

            this._topic = options.topic;
            if (!this._topic) throw new Error('No topic!');
            this._socket.on(this._topic, this._incomingMessage.bind(this));
        }

        get myAddress() {
            return this._topic;
        }

        /**
         *
         * @param {MsgCommon} objMessage - message to send to peer
         */
        async sendMessage(objMessage) {
            if (this._delay) await sleep(this._delay);
            debug(`sendMessage delay ${this._delay}`);
            this._socket.emit(this._topic, Serializer.serialize(objMessage));
        }

        async _incomingMessage(objMessage) {
            if (this._delay) await sleep(this._delay);
            debug(`_incomingMessage delay ${this._delay}`);
            this.emit('message', Serializer.deSerialize(objMessage));
        }

        /**
         *
         * @return {Promise<Object>} - message
         */
        receiveSync() {
            return new Promise(resolve => {
                this.on('message', async objMessage => {
                    resolve(objMessage);
                });
            });
        }

        /**
         * Address of this end of connection
         */
        isMyAddressPrivate() {
            return false;
        }
    };
