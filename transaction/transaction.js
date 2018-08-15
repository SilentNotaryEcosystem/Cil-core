const Payload = require('./payload');
const { toBuffer } = require('./utills');
const BN = require('bn.js');
const Crypto = require('../crypto/crypto');
const rlp = require('rlp');

module.exports = class Transaction {
    constructor(payload) {
        this._payload = payload;
    }

    get payload() {
        return this._payload;
    }

    get signature() {
        return this._signature;
    }

    set signature(value) {
        this._signature = value;
    }

    get publicKey(){
        if (!this.signature)
            return null;
        try {
            let key = Crypto.getPublicKey(this.hash(false), this.signature, this.signature.v - 27);
            return key.encode('hex', true);
        }
        catch (err) {
            return null;
        }
    }

    hash(includeSignature) {
        let ret = [];
        ret.push(toBuffer(this.payload.nonce));
        ret.push(toBuffer(this.payload.gasLimit));
        ret.push(toBuffer(this.payload.gasPrice));
        ret.push(toBuffer(this.payload.to));
        ret.push(toBuffer(this.payload.value));
        ret.push(toBuffer(this.payload.extField));
        if (includeSignature && this._signature) {
            ret.push(toBuffer(this._signature.v));
            ret.push(toBuffer(this._signature.r));
            ret.push(toBuffer(this._signature.s));
        }

        return ret;
    }

    serialize() {
        return rlp.encode(this.hash(true));
    }

    static deserialize(data) {
        if (typeof data === 'string')
            data = Buffer.from(data, "hex")
        let tr = rlp.decode(data);

        let payload = new Payload(new BN(tr[0]).toNumber(),
            new BN(tr[1]).toNumber(),
            new BN(tr[2]).toNumber(),
            tr[3].toString('utf8'),
            new BN(tr[4]).toNumber(),
            tr[5].toString('utf8')
        );

        let signature = {};
        signature.v = new BN(tr[6]).toNumber();
        signature.r = new BN(tr[7]);
        signature.s = new BN(tr[8]);

        let transact = new Transaction(payload);
        transact.signature = signature;

        return transact;
    }

    sign(privateKey) {
        this._signature = Crypto.signTransaction(this.hash(false), privateKey);
    };

    validate() {
        if (!this.signature)
            return false;
        try {
            let publicKey = Crypto.getPublicKey(this.hash(false), this.signature, this.signature.v - 27);
            return Crypto.verify(this.hash(false), this.signature, publicKey);
        }
        catch (err) {
            return false;
        }
    };
};
