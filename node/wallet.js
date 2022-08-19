'use strict';

module.exports = Crypto =>
    class Wallet {
        constructor(privateKey) {
            if (!privateKey) throw new Error('You need private key to init wallet');
            if (typeof privateKey === 'string') {
                this._keyPair = Crypto.keyPairFromPrivate(privateKey, 'hex');
            } else {
                this._keyPair = Crypto.keyPairFromPrivate(privateKey);
            }
            this._address = Crypto.getAddress(this._keyPair.getPublic(true, 'hex'));
        }

        get address() {
            return this._address;
        }

        get publicKey() {
            return this._keyPair.getPublic(true, 'hex');
        }

        get privateKey() {
            return this._keyPair.getPrivate('hex');
        }

        sign(data) {
            return Crypto.sign(data, this._keyPair.getPrivate('hex'));
        }
    };
