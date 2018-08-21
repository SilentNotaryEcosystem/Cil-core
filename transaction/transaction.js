module.exports = (Crypto, TransactionProto, TransactionPayloadProto) =>
    class Transaction {
        constructor(data) {
            if (Buffer.isBuffer(data)) {
                this._data = { ...TransactionProto.decode(data) };
                this._setPublicKey();
                this._encodedPayload = null;
            } else if (typeof data === 'object') {
                const errMsg = TransactionProto.verify(data);
                if (errMsg) throw new Error(`Transaction: ${errMsg}`);

                this._data = TransactionProto.create(data);
            } else {
                throw new Error('Use buffer or object to initialize Transaction');
            }
        }

        encodePayload() {
            this._encodedPayload = TransactionPayloadProto.encode(this.payload).finish();
        }

        hash() {
            if (!this._encodedPayload)
                this.encodePayload();
            return Crypto.createHash(this._encodedPayload);
        }

        get payload() {
            return this._data.payload;
        }

        get signature() {
            return this._data.signature;
        }

        get _signatureRecoveryParam() {
            return this._data.signatureRecoveryParam;
        }

        _setPublicKey() {
            this._publicKey = Crypto.recoverPubKey(this.hash(), this.signature, this._signatureRecoveryParam);
        }

        get publicKey() {
            if (!this.signature)
                return null;
            try {
                if (!this._publicKey) {
                    this._setPublicKey();
                }
                return this._publicKey;
            }
            catch (err) {
                return null;
            }
        }

        encode() {
            return TransactionProto.encode(this._data).finish();
        }

        sign(privateKey) {
            const { signature, recoveryParam } = Crypto.sign(this.hash(), privateKey, undefined, undefined, true);
            this._data.signature = signature;
            this._data.signatureRecoveryParam = recoveryParam;
        };

        verifySignature() {
            if (!this.signature)
                return false;
            try {
                return Crypto.verify(this.hash(), this.signature, this.publicKey);
            }
            catch (err) {
                return false;
            }
        };
    };
