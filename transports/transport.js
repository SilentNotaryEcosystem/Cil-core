const EventEmitter=require('events');
const Connection=require('./connection');

class Transport extends EventEmitter{

    /**
     *
     * @param {Object} options
     */
    constructor(options){
        super();
        this._delay = options.delay !== undefined ? options.delay : parseInt(Math.random() * 10 * 1000);
    }

    async connect(address){
        throw new Error('Should implement!');
//        this._address=address;
//        return new Connection({delay: this._delay});
    }

    listen(address){
        throw new Error('Should implement!');
//        this._address=address;
//        transport.listen(this._address);
//        tramsport.on('connect', () => this.emit(new Connection()))
    }

}

module.exports=Transport;
