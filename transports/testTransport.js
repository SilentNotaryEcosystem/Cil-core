

const EventEmitter=require('events');

const Transport=require('./transport');
const StringSerializer=require('./stringSerializer');

/**
 *
 * @param {Number} delay - задержка в миллисекундах
 * @return {Promise<any>}
 */
const sleep = (delay) => {
    return new Promise(resolve => {
        setTimeout(() => resolve(), delay);
    });
};

/**
 * Это тестовый транспорт на EventEmitter'е.
 * Эмулирует задержку.
 */

const EventBus=new EventEmitter();

class TestTransport extends Transport{

    /**
     *
     * @param {Object} options
     * @param {Number} options.delay - задержка которой мы будем эмулировать network latency в СЕКУНДАХ!
     */
    constructor(options={delay: parseInt(Math.random()*10)}){
        super(StringSerializer);
        this._delay=options.delay*1000;
    }

    /**
     * @param {String} topic - строка которую будем использовать в отдельного топика в EventEmitter
     */
    async connect(topic){
        this._topic=topic;
        EventBus.on(topic, this.incomingMessage.bind(this))
    }

    listen(topic){
        this._topic=topic;
        EventBus.on(topic, this.incomingMessage.bind(this))
    }

    /**
     *
     * @param {Object} objMessage - message to send to peer
     */
    sendMessage(objMessage){
        EventBus.emit(this._topic, StringSerializer.serialize(objMessage))
    }

    async incomingMessage(objMessage){
        await sleep(this._delay);
        this.emit('message', StringSerializer.deSerialize(objMessage))
    }
}

module.exports=TestTransport;
