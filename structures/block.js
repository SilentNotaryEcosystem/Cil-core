const typeforce = require('typeforce');
const types = require('../types');

module.exports = ({Constants, Crypto}, {blockProto, blockPayloadProto}) =>
    class Block {
        constructor(data) {
            typeforce(typeforce.oneOf('Object', 'Buffer', types.Empty), data);

            if (data === undefined) data = {payload: blockPayloadProto.create({})};

            if (Buffer.isBuffer(data)) {
                this._data = blockProto.decode(data);
            } else if (typeof data === 'object') {
                const errMsg = blockProto.verify(data);
                if (errMsg) throw new Error(`Block: ${errMsg}`);

                this._data = blockProto.create(data);
            }
        }

        hash() {
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
            this._encodedPayload = blockPayloadProto.encode(this.payload).finish();
        }

        encode() {
            return blockProto.encode(this._data).finish();
        }

        /**
         *
         * @param {Transaction} tx
         */
        addTx(tx) {
            this.payload.txns.push(tx.rawData);
        }
    };
