const EventEmitter=require('events');
const Serializer=require('./serializer');

/**
 *
 * @param {Number} delay - задержка в миллисекундах
 * @return {Promise<any>}
 */

class Connection extends EventEmitter{

    /**
     *
     * @param {Object} options
     * @param {Number} options.delay - delay to emulate network latency
     * @param {EventEmitter} options.socket - instance derived from EventEmitter
     */
    constructor(options){
        super();

        // optional delay to simulate network latency
        this._delay = options.delay !== undefined ? options.delay : parseInt(Math.random() * 10 * 1000);
        this._socket=options.socket;
        if(!this._socket) throw new Error('No socket!');
    }

    /**
     *
     * @param {Object} objMessage - message to send to peer
     */
    sendMessage(objMessage){
        throw new Error('Should implement!');
//        this._socket.emit(this._topic, Serializer.serialize(objMessage))
    }

    async _incomingMessage(objMessage){
        throw new Error('Should implement!');
//        if(this._delay) await sleep(this._delay);
//        this.emit('message', Serializer.deSerialize(objMessage))
    }

}

module.exports = Connection;
