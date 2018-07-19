const Connection=require('./connection');
const StringSerializer=require('./stringSerializer');

const sleep = (delay) => {
    return new Promise(resolve => {
        setTimeout(() => resolve(), delay);
    });
};

/**
 * Это тестовый транспорт на EventEmitter'е (топик в address)
 * Может эмулировать задержку через options.delay
 */

class TestConnection extends Connection{
    constructor(options){
        super(options);
        this._topic=options.topic;
        if(!this._topic) throw new Error('No topic!');
        this._socket.on(this._topic, this._incomingMessage.bind(this));
    }
    /**
     *
     * @param {Object} objMessage - message to send to peer
     */
    sendMessage(objMessage){
        this._socket.emit(this._topic, StringSerializer.serialize(objMessage))
    }

    async _incomingMessage(objMessage){
        if(this._delay) await sleep(this._delay);
        this.emit('message', StringSerializer.deSerialize(objMessage))
    }
}

module.exports = TestConnection;
