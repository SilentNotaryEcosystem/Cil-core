const EventEmitter = require('events');
const uuid = require('node-uuid');
const debug = require('debug')('testTransport');

const {sleep} = require('../utils');
const TestConnectionWrapper = require('./testConnection');

/**
 * Это тестовый транспорт на EventEmitter'е (топик в address)
 * Может эмулировать задержку через options.delay
 */

const EventBus = new EventEmitter();

module.exports = (SerializerImplementation, Constants) => {

    const TestConnection = TestConnectionWrapper(SerializerImplementation, Constants);
    return class TestTransport extends EventEmitter {

        /**
         *
         * @param {Object} options
         * @param {Number} options.delay
         */
        constructor(options) {
            super();

            this._delay = options.delay !== undefined ? options.delay : parseInt(Math.random() * 10 * 1000);
            this._timeout = options.timeout || Constants.CONNECTION_TIMEOUT;

            // here should be some public address @see os.networkInterfaces
            this._address = options.listenAddr || uuid.v4();
            this._port = options.listenPort || Constants.port;
        }

        get myAddress() {
            if (!this._chachedAddr) {
                this._chachedAddr = this.constructor.addressToBuffer(this._address);
            }
            return this._chachedAddr;
        }

        /**
         * Return at least 16 bytes (length of ipv6 address) buffer created from address
         * If needed it will be padded with 0 from start
         * Will be replaced with real ipv6 buffer
         *
         * @param {String} address
         * @return {Buffer}
         */
        static addressToBuffer(address) {
            const buffer = Buffer.from(address);
            const bytestoPadd = buffer.length > 16 ? 0 : 16 - buffer.length;
            return bytestoPadd ? Buffer.concat([Buffer.alloc(bytestoPadd), buffer]) : buffer;
        }

        static isPrivateAddress(address) {
            return false;
        }

        /**
         * @param {String} address - строка которую будем использовать в отдельного топика в EventEmitter
         * @return {Connection} new connection
         */
        async connect(address) {

            // pass a connection_id
            const topic = uuid.v4();
            EventBus.emit(address, topic);
            debug(`Connect delay ${this._delay}`);
            if (this._delay) await sleep(this._delay);
            return new TestConnection({delay: this._delay, socket: EventBus, topic, timeout: this._timeout});
        }

        /**
         * Emit 'connect' with new Connection
         *
         */
        listen() {

            // TODO: use port
            EventBus.on(this._address, async topic => {
                if (this._delay) await sleep(this._delay);
                debug(`Listen (topic: ${topic}) delay ${this._delay}`);
                this.emit('connect',
                    new TestConnection({delay: this._delay, socket: EventBus, topic, timeout: this._timeout})
                );
            });
        }

        /**
         * Emulate Sync version on listen
         * Useful on tests
         *
         * @return {Promise<Connection>} new connection
         */
        listenSync() {
            const prom = new Promise(resolve => {
                this.listen();
                this.once('connect', connection => resolve(connection));
            });
            return Promise.race([prom, sleep(this._timeout)]);
        }

        /**
         * split name by ':'
         *
         * @param name
         * @return {Promise<*|string[]>}
         */
        async resolveName(name) {
            return name.split(':');
        }

        cleanUp() {
            EventBus.removeAllListeners(this._address);
        }
    };
};
