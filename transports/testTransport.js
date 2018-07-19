const EventEmitter = require('events');
const uuid=require('node-uuid');

const Transport = require('./transport');
const TestConnection = require('./testConnection');

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
        return new TestConnection({delay: this._delay, socket: EventBus, topic});
    }

    /**
     * Emit 'connect' with new Connection
     *
     * @param {String} address - строка которую будем использовать в отдельного топика в EventEmitter
     */
    listen(address) {
        EventBus.on(address, topic =>{
            this.emit('connect', new TestConnection({delay: this._delay, socket: EventBus, topic}));
        });
    }
}

module.exports = TestTransport;
