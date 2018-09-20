const typeforce = require('typeforce');
const types = require('../types');

module.exports = ({Constants, Crypto, Transaction}, {blockProto, blockPayloadProto}) =>
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

        /**
         *
         * @returns {String} !!
         */
        hash() {
            if (!this._hashCache) {
                if (!this._encodedPayload) {
                    this.encodePayload();
                }
                this._hashCache = Crypto.createHash(this._encodedPayload);
            }
            return this._hashCache;
        }

        get payload() {
            return this._data.payload;
        }

        get witnessGroupId() {
            return this._data.payload.witnessGroupId;
        }

        set witnessGroupId(id) {
            this._data.payload.witnessGroupId = id;
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

            // invalidate cache (if any)
            this._hashCache = undefined;
            this.payload.txns.push(tx.rawData);
        }

        getTxHashes() {
            return this.txns.map(objTx => (new Transaction(objTx)).hash());
        }

        isEmpty() {
            return !this.txns.length;
        }
    };
