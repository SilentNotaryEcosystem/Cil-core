const { toBuffer } = require('./utills');
const BN = require('bn.js');

module.exports = (Crypto, TransactionProto, TransactionPayloadProto) =>
    class Transaction {
        constructor(data) {
            if (Buffer.isBuffer(data)) {
                this._data = { ...TransactionProto.decode(data) };
            } else if (typeof data === 'object') {
                const errMsg = TransactionProto.verify(data);
                if (errMsg) throw new Error(`Transaction: ${errMsg}`);

                this._data = TransactionProto.create(data);
            } else {
                throw new Error('Use buffer or object to initialize Transaction');
            }
        }

        encode(forSign = false) {
            return forSign ? TransactionPayloadProto.encode(this._data.payload).finish() : TransactionProto.encode(this._data).finish();
        }

        get payload() {
            return this._data.payload;
        }

        get signature() {
            return {
                r: new BN(this._data.signature.r),
                s: new BN(this._data.signature.s), 
                recoveryParam: this._data.signature.recoveryParam
            };
        }

        set signature(value) {
            this._data.signature = { r: toBuffer(value.r), s: toBuffer(value.s), recoveryParam: value.recoveryParam };
        }

        get publicKey() {
            if (!this.signature)
                return null;
            try {
                return Crypto.recoverPubKey(this.encode(true), this.signature, this.signature.recoveryParam);
            }
            catch (err) {
                return null;
            }
        }

        serialize() {
            return this.encode();
        }

        sign(privateKey) {
            this.signature = Crypto.sign(this.encode(true), privateKey, undefined, undefined, false);
        };

        verifySignature() {
            if (!this.signature)
                return false;
            try {
                return Crypto.verify(this.encode(true), this.signature, this.publicKey);
            }
            catch (err) {
                return false;
            }
        };
    };
