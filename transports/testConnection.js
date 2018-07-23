const Connection=require('./connection');
const StringSerializer=require('./stringSerializer');
const debug=require('debug')('testConnection');

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
    async sendMessage(objMessage){
        if(this._delay) await sleep(this._delay);
        debug(`sendMessage delay ${this._delay}`);
        this._socket.emit(this._topic, StringSerializer.serialize(objMessage))
    }

    async _incomingMessage(objMessage){
        if(this._delay) await sleep(this._delay);
        debug(`_incomingMessage delay ${this._delay}`);
        this.emit('message', StringSerializer.deSerialize(objMessage))
    }

    /**
     *
     * @return {Promise<Object>} - message
     */
    receiveSync(){
        return new Promise(resolve => {
            this.on('message', async objMessage => {
                resolve(objMessage);
            });
        });
    }
}

module.exports = TestConnection;
