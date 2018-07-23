const Crypto=require('./crypto/crypto');
const Transport=require('./transports/testTransport.js');
const Serializer=require('./transports/stringSerializer');
const Network=require('./layers/network');
const Wallet=require('./wallet/wallet');

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

    static get Network(){
        return Network;
    }

    static get Wallet(){
        return Wallet;
    }
}

module.exports = Factory;
