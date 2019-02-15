const typeforce = require('typeforce');
const types = require('../types');

module.exports = ({Constants, Crypto}, {inventoryProto}) =>
    class Inventory {
        constructor(data) {
            typeforce(typeforce.oneOf('Number', 'Buffer', types.Empty), data);

            this._setHashes = new Set();
            if (data === undefined) data = {};

            if (Buffer.isBuffer(data)) {
                this._data = {...inventoryProto.decode(data)};
                for (let elem of this._data.invVector) {
                    this._setHashes.add(elem.hash.toString('hex'));
                }
            } else if (typeof data === 'object') {
                const errMsg = inventoryProto.verify(data);
                if (errMsg) throw new Error(`Inventory: ${errMsg}`);

                this._data = inventoryProto.create(data);
            }
        }

        encode() {
            return inventoryProto.encode(this._data).finish();
        }

        /**
         *
         * @param {Transaction} tx
         */
        addTx(tx) {
            if (this._wasAlreadyAdded(tx.hash())) return;

            const vector = {type: Constants.INV_TX, hash: Buffer.from(tx.hash(), 'hex')};
            this._data.invVector.push(vector);
            this._markAsAdded(tx.hash());
        }

        /**
         *
         * @param {String | Buffer} hash
         */
        addTxHash(hash) {
            typeforce(types.Hash256bit, hash);
            hash = Buffer.isBuffer(hash) ? hash : Buffer.from(hash, 'hex');
            const strHash = Buffer.isBuffer(hash) ? hash.toString('hex') : hash;

            if (this._wasAlreadyAdded(strHash)) return;

            const vector = {type: Constants.INV_TX, hash};
            this._data.invVector.push(vector);
            this._markAsAdded(strHash);
        }
        /**
         *
         * @param {Block} block
         */
        addBlock(block) {
            if (this._wasAlreadyAdded(block.hash())) return;

            const vector = {type: Constants.INV_BLOCK, hash: Buffer.from(block.getHash(), 'hex')};
            this._data.invVector.push(vector);
            this._markAsAdded(block.hash());
        }

        /**
         *
         * @param {String | Buffer} hash
         */
        addBlockHash(hash) {
            typeforce(types.Hash256bit, hash);
            hash = Buffer.isBuffer(hash) ? hash : Buffer.from(hash, 'hex');
            const strHash = Buffer.isBuffer(hash) ? hash.toString('hex') : hash;

            if (this._wasAlreadyAdded(strHash)) return;

            const vector = {type: Constants.INV_BLOCK, hash};
            this._data.invVector.push(vector);
            this._markAsAdded(strHash);
        }

        get vector() {
            return this._data.invVector;
        }

        addVector(vector) {
            typeforce(types.InvVector, vector);

            this._data.invVector.push(vector);
        }

        _wasAlreadyAdded(strHash) {
            return this._setHashes.has(strHash);
        }

        _markAsAdded(strHash) {
            this._setHashes.add(strHash);
        }
    };
