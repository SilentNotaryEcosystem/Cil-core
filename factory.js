const Crypto=require('./crypto/crypto');
const Transport=require('./transports/testTransport.js');
const Serializer=require('./transports/stringSerializer');

class Factory{
    static get Crypto(){
        return Crypto;
    }

    static Transport(){
        return Transport;
    }

    static get Serializer(){
        return Serializer;
    }
}

module.exports = Factory;
