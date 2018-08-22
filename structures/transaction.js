module.exports = (Crypto, TransactionProto, TransactionPayloadProto) =>
    class Transaction {
        constructor(data) {
            if (Buffer.isBuffer(data)) {
                this._data = {...TransactionProto.decode(data)};
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

        get hash() {
            if (!this._encodedPayload) {
                this.encodePayload();
            }
            return Crypto.createHash(this._encodedPayload);
        }

        get payload() {
            return this._data.payload;
        }

        get rawData() {
            return this._data;
        }

        get signature() {
            return Crypto.signatureFromBuffer(this._data.signature);
        }

        _setPublicKey() {
            this._publicKey = Crypto.recoverPubKey(this.hash, this.signature);
        }

        get publicKey() {
            if (!this.signature) {
                return null;
            }
            try {
                if (!this._publicKey) {
                    this._setPublicKey();
                }
                return this._publicKey;
            }
            catch (err) {
                logger.error(err);
                return null;
            }
        }

        encode() {
            return TransactionProto.encode(this._data).finish();
        }

        sign(privateKey) {
            this._data.signature = Crypto.sign(this.hash, privateKey);
        };

        verifySignature() {
            if (!this.signature) {
                return false;
            }
            try {
                return Crypto.verify(this.hash, this._data.signature, this.publicKey, 'hex');
            }
            catch (err) {
                logger.error(err);
                return false;
            }
        };
    };
