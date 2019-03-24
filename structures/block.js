const typeforce = require('typeforce');
const MerkleTree = require('merkletreejs');
const types = require('../types');
const {timestamp} = require('../utils');

module.exports = ({Constants, Crypto, Transaction}, {blockProto, blockHeaderProto}) =>

    class Block {
        constructor(data) {
            typeforce(typeforce.oneOf('Object', 'Buffer', 'Number'), data);

            this._final = false;
            if (typeof data === 'number') {
                data = {header: blockHeaderProto.create({witnessGroupId: data})};
            }

            if (Buffer.isBuffer(data)) {
                this._data = blockProto.decode(data);
                this._final = true;
            } else if (typeof data === 'object') {
                const errMsg = blockProto.verify(data);
                if (errMsg) throw new Error(`Block: ${errMsg}`);
                this._data = blockProto.create(data);
            } else {
                throw new Error('witnessGroupId mandatory for block creation');
            }

            if (!this._data.header.version) this._data.header.version = Constants.BLOCK_VERSION || 1;
        }

        /**
         *
         * @returns {Array} of strings!
         */
        get parentHashes() {
            return this._data.header.parentHashes.map(hash => hash.toString('hex'));
        }

        set parentHashes(arrStrHashes) {
            this._hashCache = undefined;
            this._data.header.parentHashes = arrStrHashes.map(strHash => Buffer.from(strHash, 'hex'));
        }

        get merkleRoot() {
            return this._data.header.merkleRoot;
        }

        get witnessGroupId() {
            return this._data.header.witnessGroupId;
        }

        get txns() {
            return this._data.txns;
        }

        get signatures() {
            return this._data.signatures;
        }

        get header() {
            return this._data.header;
        }

        /**
         *
         * @returns {String} !!
         */
        hash() {
            if (!this._final) throw new Error('Call finish() before calculating hash');
            if (!this._hashCache) {
                this._buildTxTree();
                this._hashCache = Crypto.createHash(blockHeaderProto.encode(this._data.header).finish());
            }
            return this._hashCache;
        }

        /**
         * Alias for hash()
         *
         * @returns {String}
         */
        getHash() {
            return this.hash();
        }

        /**
         *
         * @private
         */
        _buildTxTree() {

            // MerkleTree hangs on empty arrays!
            if (!this._data.txns.length) throw new Error('Empty block! Should be at least a coinbase TX!');

            const leaves = this._data.txns.map(tx => {
                const cTx = new Transaction(tx);
                return cTx.hash();
            });
            const tree = new MerkleTree(leaves, Crypto.createHashBuffer.bind(Crypto), {isBitcoinTree: true});

            // tree.getRoot() returns buffer, BUT return string if has only one leaf (coinbase)!!
            this._data.header.merkleRoot = Buffer.from(tree.getRoot(), 'hex');
        }

        encode() {
            if (!this._final) throw new Error('Call finish() before encoding');
            return blockProto.encode(this._data).finish();
        }

        encodeHeader() {
            if (!this._final) throw new Error('Call finish() before encoding');
            return blockHeaderProto.encode(this._data.header).finish();
        }

        /**
         *
         * @param {Transaction} tx
         */
        addTx(tx) {
            if (this._final) throw new Error('This block was already final!');

            // invalidate cache (if any)
            this._hashCache = undefined;
            this._data.txns.push(tx.rawData);
        }

        getTxHashes() {
            return this.txns.map(objTx => (new Transaction(objTx)).hash());
        }

        isEmpty() {
            return this.txns.length === 1 && (new Transaction(this.txns[0])).isCoinbase();
        }

        finish(totalTxnsFees, pubkeyReceiver) {
            typeforce.Number(totalTxnsFees);
            typeforce(types.PublicKey, pubkeyReceiver);

            this._hashCache = undefined;
            const buffReceiverAddr = Crypto.getAddress(pubkeyReceiver, true);

            const coinbase = Transaction.createCoinbase();
            coinbase.witnessGroupId = this.witnessGroupId;
            coinbase.addReceiver(totalTxnsFees, buffReceiverAddr);

            // to make coinbase hash unique add one more random output with 0 coins
            coinbase.addReceiver(0, Crypto.randomBytes(20));

            this._data.txns.unshift(coinbase.rawData);
            this._buildTxTree();

            this._data.header.timestamp = timestamp();
            this._final = true;
        }

        addWitnessSignatures(arrSignatures) {
            typeforce(typeforce.arrayOf(types.Signature), arrSignatures);

            this._data.signatures = arrSignatures.slice();
        }

        toObject() {
            return {
                header: this._data.header,
                signatures: this._data.signatures,
                tnxs: this._data.txns.map(objTx => (new Transaction(objTx)).getHash())
            };
        }
    };
