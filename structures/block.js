module.exports = (Crypto, BlockProto, BlockPayloadProto) =>
    class Block {
        constructor(data) {
            if (Buffer.isBuffer(data)) {
                this._data = {...BlockProto.decode(data)};
            } else if (typeof data === 'object') {
                const errMsg = BlockProto.verify(data);
                if (errMsg) throw new Error(`Block: ${errMsg}`);

                this._data = BlockProto.create(data);
            } else {
                this._data = {
                    payload: BlockPayloadProto.create({})
                };
            }
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

        get txns() {
            return this._data.payload.txns;
        }

        encodePayload() {
            this._encodedPayload = BlockPayloadProto.encode(this.payload).finish();
        }

        encode() {
            return BlockProto.encode(this._data).finish();
        }

        /**
         *
         * @param {Transaction} tx
         */
        addTx(tx) {
            this.payload.txns.push(tx.rawData);
        }
    };
