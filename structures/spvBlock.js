const typeforce = require('typeforce');
const MerkleTree = require('merkletreejs');
const types = require('../types');

module.exports = ({ Constants, Crypto, Transaction }, { blockProto, spvBlockProto, blockHeaderProto }) =>
    class SPVBlock {
        constructor(data, filter) {
            // typeforce(typeforce.oneOf('Object', 'Buffer', 'Number'), data);

            if (typeof data === 'object') {
                const errMsg = blockProto.verify(data);
                if (errMsg) throw new Error(`SPVBlock: ${errMsg}`);
                this._data = spvBlockProto.create(data);
                this._buildTxTree();
                if (filter) {
                    this._filter();
                    this._syncMerkleProofs();
                }
            } else {
                throw new Error('data is not a block instance');
            }
        }

        get merkleRoot() {
            return this._data.header.merkleRoot;
        }

        get merkleProofs() {
            return this._data.merkleProofs;
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

        get mci() {
            return this._data.header.mci;
        }

        set mci(value) {
            return this._data.header.mci = value;
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

            // MerkleTree hangs on empty arrays!
            if (!this._data.txns.length) throw new Error('Empty block! Should be at least a coinbase TX!');

            const leaves = this._data.txns.map(tx => {
                const cTx = new Transaction(tx);
                return new Buffer(cTx.hash());
            });
            const tree = new MerkleTree(leaves, Crypto.createHashBuffer.bind(Crypto), { isBitcoinTree: true });

            this._data.header.merkleRoot = tree.getRoot();

            this._insideMerkleProofs = leaves.map(leaf => { return { hash: leaf.toString('hex'), proof: tree.getProof(leaf) } });
            this._data.merkleProofs = this._insideMerkleProofs.map(leaf => leaf.proof);
        }

        /**
         * Filtering transaction list by bloom filter
         * @private
         * @param {Object} bloomFilter - Instance of BloomFilter
         */
        _filter(bloomFilter) {
            this._data.txnsHashes = this._data.txns
                .filter(tx => {
                    const txn = new Transaction(tx);
                    return !(bloomFilter.test(txn.hash())
                        || txn.outputs && txn.outputs.some(out => bloomFilter.test(out.codeClaim.toString('hex'))))
                })
                .map(tx => (new Transaction(tx)).hash());

            const newTxns = this._data.txns.filter(tx => {
                const txn = new Transaction(tx);
                return bloomFilter.test(txn.hash())
                    || txn.outputs && txn.outputs.some(out => bloomFilter.test(out.codeClaim.toString('hex')))
            });

            this._data.txns = newTxns;


            // let newTxns = [];
            // for (let i = 0; i < this._data.txns.length; i++) {
            //     const tx = this._data.txns[i];
            //     const txHash = tx.hash();
            //     if (bloomFilter.test(txHash)
            //         || tx.outputs && tx.outputs.some(out => bloomFilter.test(out.codeClaim.toString('hex')))) {
            //         //Transaction matches bloom filter
            //         newTxns.push(tx);
            //     }
            //     else {
            //         this._data.txnsHashes.push(txHash);
            //     }
            // }
        }

        /**
         * Remove transactions from merkle proofs that arent in the filter
         * @private
         */
        _syncMerkleProofs() {
            if (this._data.merkleProofs.length === this._data.txns.length)
                return;
            if (Array.isArray(this._data.txnsHashes) && this._data.txnsHashes.length > 0)
                this._data.merkleProofs = this._insideMerkleProofs
                    .filter(leaf => this._data.txnsHashes.indexOf(leaf.hash) < 0)
                    .map(leaf => leaf.proof);
        }

        verify() {
            if (this._data.txns.length !== this._data.merkleProofs.length)
                throw new Error('The number of proofs does not match the number of transactions');

            const tree = new MerkleTree({}, Crypto.createHashBuffer.bind(Crypto), { isBitcoinTree: true });

            for (let i = 0; i < this._data.txns.length; i++) {
                const tx = new Transaction(this._data.txns[i]);
                if (!tree.verify(this._data.merkleProofs[i], tx.hash(), this._data.header.merkleRoot)) {
                    return false;
                }
            }
            return true;
        }

        encode() {
            return spvBlockProto.encode(this._data).finish();
        }

        getTxHashes() {
            return this.txns.map(objTx => (new Transaction(objTx)).hash());
        }

        isEmpty() {
            return this.txns.length === 1 && (new Transaction(this.txns[0])).isCoinbase();
        }
    };
