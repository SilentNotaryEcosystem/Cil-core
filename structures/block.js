const typeforce = require('typeforce');
const MerkleTree = require('merkletreejs');
const types = require('../types');

module.exports = ({Constants, Crypto, Transaction}, {blockProto, blockHeaderProto}) =>
    class Block {
        constructor(data) {
            typeforce(typeforce.oneOf('Object', 'Buffer', 'Number'), data);

            if (typeof data === 'number') {
                data = {header: blockHeaderProto.create({witnessGroupId: data})};
            }

            if (Buffer.isBuffer(data)) {
                this._data = blockProto.decode(data);
            } else if (typeof data === 'object') {
                const errMsg = blockProto.verify(data);
                if (errMsg) throw new Error(`Block: ${errMsg}`);

                this._data = blockProto.create(data);
            } else {
                throw new Error('witnessGroupId mandatory for block creation');
            }
        }

        get merkleRoot() {
            return this._data.header.merkleRoot;
        }

        get witnessGroupId() {
            return this._data.witnessGroupId;
        }

        get txns() {
            return this._data.txns;
        }

        /**
         *
         * @returns {String} !!
         */
        hash() {
            if (!this._hashCache) {
                this._buildTxTree();
                this._hashCache = Crypto.createHash(blockHeaderProto.encode(this._data.header).finish());
            }
            return this._hashCache;
        }

        /**
         *
         * @private
         */
        _buildTxTree() {

            // TODO: replace this dummy with coinbase TX!
            // MerkleTree hangs on empty arrays!
            if (!this._data.txns.length) {
                this._data.header.merkleRoot = Buffer.alloc(32, 0);
                return;
            }

            const leaves = this._data.txns.map(tx => {
                const cTx = new Transaction(tx);
                return cTx.hash();
            });
            const tree = new MerkleTree(leaves, Crypto.createHashBuffer.bind(Crypto), {isBitcoinTree: true});

            // tree.getRoot() returns buffer
            this._data.header.merkleRoot = tree.getRoot();
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
            this._data.txns.push(tx.rawData);
        }

        getTxHashes() {
            return this.txns.map(objTx => (new Transaction(objTx)).hash());
        }

        isEmpty() {
            return !this.txns.length;
        }
    };
