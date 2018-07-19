const EventEmitter=require('events');

class Transport extends EventEmitter{

    /**
     *
     */
    constructor(serializer){
        super();
        if(!serializer) throw new Error('Specify serializer!');
        this._serializer=serializer;
    }

    /**
     * Here should be some handshake
     *
     * @param {String} peerAddr - address of peer to connect
     */
    async connect(){
        this._peerAddr=peerAddr;
        throw new Error('Should implement!');
    }

    /**
     * Here should be some handshake
     *
     * @param {String} address - address to bind for incoming connection
     * @param {String} port - port to bind for incoming connection
     */
    listen(address=null, port=null){
        throw new Error('Should implement!');
    }

    /**
     *
     * @param {Object} objMessage - message to send to peer
     */
    sendMessage(objMessage){
        throw new Error('Should implement!');
        this._serializer.serialize(objMessage);

    }

    /**
     *
     * @param {Mixed} message - received from peer
     */
    incomingMessage(message){
        throw new Error('Should implement!');
        this.emit('message',this._serializer.deSerialize(message));
    }
}

module.exports=Transport;
