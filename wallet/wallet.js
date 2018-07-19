'use strict';

const Crypto=require('../crypto/crypto');

class Wallet {
    constructor(privateKey) {
        if(typeof privateKey === 'string'){
            this._keyPair = Crypto.keyPairFromPrivate(privateKey, 'hex');
        }else{
            this._keyPair = Crypto.keyPairFromPrivate(privateKey);
        }
        this._address=Crypto.getAddress(this._keyPair.getPublic(true, 'hex'))
    }

    get address(){
        return this._address;
    }

    get publicKey(){
        return this._keyPair.getPublic(true, 'hex');
    }

    get privateKey(){
        return this._keyPair.getPrivate('hex');
    }

    sign(data){
        return Crypto.sign(data, this._keyPair.getPrivate('hex'))
    }
}

module.exports = Wallet;
