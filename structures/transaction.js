const assert = require('assert');
const typeforce = require('typeforce');
const types = require('../types');

// TODO: calculate tx size for proper fee calculating

const CURRENT_TX_VERSION = 1;

module.exports = ({Constants, Crypto, Coins}, {transactionProto, transactionPayloadProto}) =>
    class Transaction {
        constructor(data) {
            if (Buffer.isBuffer(data)) {
                if (data.length > Constants.MAX_BLOCK_SIZE) throw new Error('Oversize transaction');

                this._data = transactionProto.decode(data);
            } else if (typeof data === 'object') {
                const errMsg = transactionProto.verify(data);
                if (errMsg) throw new Error(`Transaction: ${errMsg}`);

                this._data = transactionProto.create(data);
            } else if (data === undefined) {
                this._data = {
                    payload: {
                        witnessGroupId: 0,
                        ins: [],
                        outs: []
                    },
                    claimProofs: []
                };
            } else {
                throw new Error('Contruct from Buffer|Object|Empty');
            }
            if (!this._data.payload.version) this._data.payload.version = CURRENT_TX_VERSION;
            if (this._data.payload.witnessGroupId === undefined) {
                throw new Error('Specify witness group, who will notarize this TX');
            }

            // fix fixed64 conversion to Long. see https://github.com/dcodeIO/ProtoBuf.js/
            // If a proper way to work with 64 bit values (uint64, int64 etc.) is required,
            // just install long.js alongside this library.
            // All 64 bit numbers will then be returned as a Long instance instead of a possibly
            // unsafe JavaScript number (see).

            for (let output of this._data.payload.outs) {
                if (typeof output.amount.toNumber === 'function') output.amount = output.amount.toNumber();
            }
        }

        get witnessGroupId() {
            return this._data.payload.witnessGroupId;
        }

        set witnessGroupId(groupId) {
            return this._data.payload.witnessGroupId = groupId;
        }

        get rawData() {
            return this._data;
        }

        get inputs() {
            const checkPath = this._data &&
                              this._data.payload &&
                              this._data.payload.ins &&
                              Array.isArray(this._data.payload.ins);
            return checkPath ? this._data.payload.ins : undefined;
        }

        get outputs() {
            const checkPath = this._data &&
                              this._data.payload &&
                              this._data.payload.outs &&
                              Array.isArray(this._data.payload.outs);
            return checkPath ? this._data.payload.outs : undefined;
        }

        get claimProofs() {
            const checkPath = this._data &&
                              this._data.claimProofs &&
                              Array.isArray(this._data.claimProofs);
            return checkPath ? this._data.claimProofs : undefined;
        }

        /**
         *
         * @return {Array} utxos (Buffer!) this tx tries to spend
         */
        get utxos() {
            const inputs = this.inputs;
            if (!inputs) throw new Error('Unexpected: empty inputs!');

            return inputs.map(_in => _in.txHash);
        }

        static createCoinbase() {
            const coinbase = new this();
            coinbase.addInput(Buffer.alloc(32), 0);
            return coinbase;
        }

        static createContract(strCode, maxCoins) {
            const tx = new this();
            tx._data.payload.outs.push({
                amount: maxCoins,
                receiverAddr: Crypto.getAddrContractCreation(),
                contractCode: strCode
            });
            return tx;
        }

        static invokeContract(strContractAddr, strCode, maxCoins) {
            const tx = new this();
            tx._data.payload.outs.push({
                amount: maxCoins,
                receiverAddr: Buffer.from(strContractAddr, 'hex'),
                contractCode: strCode
            });
            return tx;
        }

        /**
         *
         * @return {Array} Coins
         */
        getOutCoins() {
            const outputs = this.outputs;
            if (!outputs) throw new Error('Unexpected: empty outputs!');

            return outputs.map(out => new Coins(out.amount, out.receiverAddr));
        }

        /**
         *
         * @param {Buffer | String} utxo - unspent tx output
         * @param {Number} index - index in tx
         */
        addInput(utxo, index) {
            typeforce(typeforce.tuple(types.Hash256bit, 'Number'), arguments);
            if (typeof utxo === 'string') utxo = Buffer.from(utxo, 'hex');

            this._checkDone();
            this._data.payload.ins.push({txHash: utxo, nTxOutput: index});
        }

        /**
         *
         * @param {Number} amount - how much to transfer
         * @param {Buffer} addr - receiver
         */
        addReceiver(amount, addr) {
            typeforce(typeforce.tuple('Number', types.Address), arguments);

            this._checkDone();
            this._data.payload.outs.push({amount, receiverAddr: Buffer.from(addr, 'hex')});
        }

        /**
         *
         * @param {String} strCodeInvocation  - method name & parameters
         * @param {Number} fee
         * @param {Buffer} addr - receiver
         */
        invokeContract(strCodeInvocation, fee, addr) {
            typeforce(typeforce.tuple('String', 'Number', types.Address), arguments);

            this._checkDone();
            this._data.payload.outs.push({
                contractCode: strCodeInvocation,
                amount: fee,
                receiverAddr: Buffer.from(addr, 'hex')
            });
        }

        /**
         * Now we implement only SIGHASH_ALL
         * The rest is TODO: SIGHASH_SINGLE & SIGHASH_NONE
         *
         * @param {Number} idx - for SIGHASH_SINGLE (not used now)
         * @return {String} !!
         */
        hash(idx) {
            return Crypto.createHash(transactionPayloadProto.encode(this._data.payload).finish());
        }

        /**
         * Is this transaction could be modified
         *
         * @private
         */
        _checkDone() {

            // it's only for SIGHASH_ALL, if implement other - change it!
            if (this._data.claimProofs.length) throw new Error('Tx is already signed, you can\'t modify it');
        }

        /**
         *
         * @param {Number} idx - index of input to sign
         * @param {Buffer | String} key - private key
         * @param {String} enc -encoding of key
         */
        sign(idx, key, enc = 'hex') {
            typeforce(typeforce.tuple('Number', types.PrivateKey), [idx, key]);

            if (idx > this._data.payload.ins.length) throw new Error('Bad index: greater than inputs length');

            const hash = this.hash(idx);
            this._data.claimProofs[idx] = Crypto.sign(hash, key, enc);
        }

        /**
         *
         * @param {Transaction} txToCompare
         * @return {boolean}
         */
        equals(txToCompare) {
            return this.hash() === txToCompare.hash() &&
                   Array.isArray(this.claimProofs) &&
                   this.claimProofs.every((val, idx) => {
                       return val.equals(txToCompare.claimProofs[idx]);
                   });
        }

        encode() {
            return transactionProto.encode(this._data).finish();
        }

        verify() {

            assert(this.witnessGroupId !== undefined, 'witnessGroupId undefined');

            // check inputs (not a coinbase & nTxOutput - non negative)
            const inputs = this.inputs;
            const insValid = inputs && inputs.length && inputs.every(input => {
                return !input.txHash.equals(Buffer.alloc(32)) &&
                       input.nTxOutput >= 0;
            });

            assert(insValid, 'Errors in input');

            // check outputs
            const outputs = this.outputs;
            const outsValid = outputs && outputs.every(output => {
                return output.amount > 0;
            });

            // we don't check signatures because claimProofs could be arbitrary value for codeScript, not only signatures
            assert(outsValid, 'Errors in outputs');

            assert(this.claimProofs.length === inputs.length, 'Errors in clamProofs');
        }

        /**
         * Check whether is this TX coinbase: only one input and all of zeroes
         *
         * @returns {boolean}
         */
        isCoinbase() {
            const inputs = this.inputs;
            return inputs && inputs.length === 1
                   && inputs[0].txHash.equals(Buffer.alloc(32))
                   && inputs[0].nTxOutput === 0;
        }

        // TODO: see todo for hasOneReceiver
        isContractCreation() {
            const outCoins = this.getOutCoins();
            return outCoins.length === 1 && outCoins[0].getReceiverAddr().equals(Crypto.getAddrContractCreation());
        }

        /**
         * Used to distinguish payment from contract call (with possible false positives)
         *
         * @return {boolean}
         */
        hasOneReceiver() {
            return this.getOutCoins().length === 1;
        }

        getCode() {
            const outputs = this.outputs;
            assert(outputs.length === 1 && outputs[0].contractCode !== undefined);
            return outputs[0].contractCode;
        }

        /**
         * Amount of coins to transfer with this TX
         *
         * @returns {*}
         */
        amountOut() {
            return this.outputs.reduce((accum, out) => accum + out.amount, 0);
        }
    };
