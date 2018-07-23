const EventEmitter = require('events');
const uuid=require('node-uuid');
const debug=require('debug')('testTransport');

const Transport = require('./transport');
const TestConnection = require('./testConnection');

const sleep = (delay) => {
    return new Promise(resolve => {
        setTimeout(() => resolve(), delay);
    });
};

/**
 * Это тестовый транспорт на EventEmitter'е (топик в address)
 * Может эмулировать задержку через options.delay
 */

const EventBus = new EventEmitter();

class TestTransport extends Transport {

    /**
     *
     * @param {Object} options
     * @param {Number} options.delay
     */
    constructor(options) {
        super(options);
    }

    /**
     * @param {String} address - строка которую будем использовать в отдельного топика в EventEmitter
     * @return {Connection} new connection
     */
    async connect(address) {

        // pass a connection_id
        const topic=uuid.v4();
        EventBus.emit(address, topic);
        debug(`Connect delay ${this._delay}`);
        if(this._delay) await sleep(this._delay);
        return new TestConnection({delay: this._delay, socket: EventBus, topic});
    }

    /**
     * Emit 'connect' with new Connection
     *
     * @param {String} address - строка которую будем использовать в отдельного топика в EventEmitter
     */
    listen(address) {
        EventBus.on(address, async topic =>{
            if(this._delay) await sleep(this._delay);
            debug(`Listen delay ${this._delay}`);
            this.emit('connect', new TestConnection({delay: this._delay, socket: EventBus, topic}));
        });
    }

    /**
     * Emulate Sync version on listen
     * Useful on tests
     *
     * @param {String} address - строка которую будем использовать в отдельного топика в EventEmitter
     * @return {Promise<Connection>} new connection
     */
    listenSync(address) {
        return new Promise(resolve =>{
            this.listen(address);
            this.on('connect', connection => resolve(connection));
        });
    }
}

module.exports = TestTransport;
