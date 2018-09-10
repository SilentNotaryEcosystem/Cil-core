const typeforce = require('typeforce');
const types = require('../types');

/*
    implementation for pay2addr.
    TODO: implement codeClaim
 */

module.exports = (Constants, Crypto, TransactionProto, TransactionPayloadProto) =>
    class Transaction {
        constructor(data) {
            if (Buffer.isBuffer(data)) {
                if (data.length > Constants.MAX_BLOCK_SIZE) throw new Error('Oversized transaction');

                this._data = {...TransactionProto.decode(data)};
            } else if (typeof data === 'object') {
                const errMsg = TransactionProto.verify(data);
                if (errMsg) throw new Error(`Transaction: ${errMsg}`);

                this._data = TransactionProto.create(data);
            } else if (data === undefined) {
                this._data = {
                    payload: {
                        ins: [],
                        outs: []
                    },
                    claimProofs: []
                };
            } else {
                throw new Error('Contruct from Buffer|Object|Empty');
            }
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
         * @param {Buffer | String} utxo - unspent tx output
         * @param {Number} index - index in tx
         */
        addInput(utxo, index) {
            if (typeof utxo === 'string') utxo = Buffer.from(utxo, 'hex');
            typeforce(typeforce.tuple(types.Hash256bit, 'Number'), arguments);

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
            this._data.payload.outs.push({amount, codeClaim: Buffer.from(addr, 'hex')});
        }

        /**
         * Now we implement only SIGHASH_ALL
         * The rest is TODO: SIGHASH_SINGLE & SIGHASH_NONE
         *
         * @param {Number} idx - for SIGHASH_SINGLE (not used now)
         * @return {Buffer|Hash|*}
         */
        hash(idx) {
            return Crypto.createHash(TransactionPayloadProto.encode(this._data.payload).finish());
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
            const arrInputsToCompare = txToCompare.inputs;
            const arrOutputsToCompare = txToCompare.outputs;
            const arrClaimProofToCompare = txToCompare.claimProofs;

            const roughEqual = (arrInputsToCompare ? this.inputs.length === arrInputsToCompare.length : true) &&
                               (arrOutputsToCompare ? this.outputs.length === arrOutputsToCompare.length : true) &&
                               (arrClaimProofToCompare
                                   ? this.claimProofs.length === arrClaimProofToCompare.length : true);
            if (!roughEqual) return false;

            // check inputs
            const insEqual = this.inputs.every((val, idx) => {
                return val.nTxOutput === arrInputsToCompare[idx].nTxOutput &&
                       val.txHash.equals(arrInputsToCompare[idx].txHash);
            });
            if (!insEqual) return false;

            // check outputs
            const outsEqual = this.outputs.every((val, idx) => {
                return val.amount === arrOutputsToCompare[idx].amount &&
                       Buffer.isBuffer(val.codeClaim) ? val.codeClaim.equals(arrOutputsToCompare[idx].codeClaim) : true;
            });
            if (!outsEqual) return false;

            // check the rest: codeClaim
            return this.claimProofs.every((val, idx) => {
                return val.equals(arrClaimProofToCompare[idx]);
            });
        }

        encode() {
            return TransactionProto.encode(this._data).finish();
        }

        verify() {

            // check inputs
            const insValid = this._data.payload.ins.every(input => {
                return !input.txHash.equals(Buffer.alloc(32)) &&
                       input.nTxOutput >= 0;
            });

            if (!insValid) return false;

            // check outputs
            const outsValid = this._data.payload.outs.every(output => {
                return output.amount > 0;
            });

            // we don't check signatures because claimProofs could be arbitrary value for codeScript, not only signatures
            return outsValid && this._data.claimProofs.length === this._data.payload.ins.length;
        }

    };
