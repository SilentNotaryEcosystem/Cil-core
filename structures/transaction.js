// part of protobuff
const Long = require('long');
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
                        conciliumId: 0,
                        ins: [],
                        outs: []
                    },
                    claimProofs: []
                };
            } else {
                throw new Error('Contruct from Buffer|Object|Empty');
            }
            if (!this._data.payload.version) this._data.payload.version = CURRENT_TX_VERSION;
            if (this._data.payload.conciliumId === undefined) {
                throw new Error('Specify witness concilium, who will notarize this TX');
            }

            // fix fixed64 conversion to Long. see https://github.com/dcodeIO/ProtoBuf.js/
            // If a proper way to work with 64 bit values (uint64, int64 etc.) is required,
            // just install long.js alongside this library.
            // All 64 bit numbers will then be returned as a Long instance instead of a possibly
            // unsafe JavaScript number (see).

            for (let output of this._data.payload.outs) {
                if (Long.isLong(output.amount)) output.amount = output.amount.toNumber();
            }
        }

        get conciliumId() {
            return this._data.payload.conciliumId;
        }

        set conciliumId(conciliumId) {
            return this._data.payload.conciliumId = conciliumId;
        }

        get rawData() {
            return this._data;
        }

        /**
         *
         * @return {Array} [{txHash, nTxOutput}]
         */
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
         * @return {Array} of Buffers this tx tries to spend
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

        /**
         *
         * @param {String} strCode
         * @param {Address} addrChangeReceiver
         * @returns {Transaction}
         */
        static createContract(strCode, addrChangeReceiver) {
            typeforce(typeforce.String, strCode);
            typeforce(typeforce.maybe(types.Address, addrChangeReceiver));

            if (addrChangeReceiver && !Buffer.isBuffer(addrChangeReceiver)) {
                addrChangeReceiver = Buffer.from(addrChangeReceiver, 'hex');
            }

            const tx = new this();
            tx._data.payload.outs.push({
                receiverAddr: Crypto.getAddrContractCreation(),
                contractCode: strCode,
                addrChangeReceiver,
                amount: 0
            });
            return tx;
        }

        /**
         *
         * @param {String} strContractAddr
         * @param {Object} objInvokeCode {method, arrArguments}
         * @param {Number} amount - coins to send to contract address
         * @param {Address} addrChangeReceiver - to use as exec fee
         * @returns {Transaction}
         */
        static invokeContract(strContractAddr, objInvokeCode, amount, addrChangeReceiver) {
            typeforce(typeforce.tuple(types.StrAddress, typeforce.Object, typeforce.Number), arguments);
            typeforce(typeforce.maybe(types.Address, addrChangeReceiver));

            if (addrChangeReceiver && !Buffer.isBuffer(addrChangeReceiver)) {
                addrChangeReceiver = Buffer.from(addrChangeReceiver, 'hex');
            }

            const tx = new this();
            tx._data.payload.outs.push({
                amount,
                receiverAddr: Buffer.from(strContractAddr, 'hex'),
                contractCode: JSON.stringify(objInvokeCode),
                addrChangeReceiver
            });
            return tx;
        }

        isContract(){
            return this._data.payload.outs.findIndex(o => o.contractCode !== undefined) !== -1;
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
         * @param {Buffer | String} strHash - unspent tx output
         * @param {Number} index - index in tx
         */
        addInput(strHash, index) {
            typeforce(typeforce.tuple(types.Hash256bit, 'Number'), arguments);
            if (typeof strHash === 'string') strHash = Buffer.from(strHash, 'hex');

            this._checkDone();
            this._data.payload.ins.push({txHash: strHash, nTxOutput: index});
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
         * Now we implement only SIGHASH_ALL
         * The rest is TODO: SIGHASH_SINGLE & SIGHASH_NONE
         *
         * @param {Number} idx - for SIGHASH_SINGLE (not used now)
         * @return {String} !!
         */
        hash(idx) {
            return this.getHash();
        }

        /**
         * SIGHASH_ALL
         *
         * @return {String} !!
         */
        getHash() {

            // TODO: implement cache
            return Crypto.createHash(transactionPayloadProto.encode(this._data.payload).finish());
        }

        /**
         * Is this transaction could be modified
         *
         * @private
         */
        _checkDone() {

            // it's only for SIGHASH_ALL, if implement other - change it!
            if (this.getTxSignature() || this._data.claimProofs.length) {
                throw new Error(
                    'Tx is already signed, you can\'t modify it');
            }
        }

        /**
         * Add clamProofs (signature of hash(idx)) for input with idx
         *
         *
         * @param {Number} idx - index of input to sign
         * @param {Buffer | String} key - private key
         * @param {String} enc -encoding of key
         */
        claim(idx, key, enc = 'hex') {
            typeforce(typeforce.tuple('Number', types.PrivateKey), [idx, key]);

            if (idx > this._data.payload.ins.length) throw new Error('Bad index: greater than inputs length');

            const hash = this.hash(idx);
            this._data.claimProofs[idx] = Crypto.sign(hash, key, enc);
        }

        /**
         * Used to prove ownership of contract
         *
         * @param {Buffer | String} key - private key
         * @param {String} enc -encoding of key
         */
        signForContract(key, enc = 'hex') {
            typeforce(types.PrivateKey, key);

            const hash = this.getHash();
            this._data.txSignature = Crypto.sign(hash, key, enc);
        }

        signAllInputs(key, enc = 'hex') {
            if (this._data.claimProofs.length) throw('You should choose: "signAllInputs" or claim per input');
            this.signForContract(key, enc);
        }

        getTxSignature() {
            return Buffer.isBuffer(this._data.txSignature) ||
                   (Array.isArray(this._data.txSignature) && this._data.txSignature.length) ?
                this._data.txSignature : undefined;
        }

        getTxSignerAddress(needBuffer = false) {
            if (!this.getTxSignature()) return undefined;
            try {
                const pubKey = Crypto.recoverPubKey(this.getHash(), this.getTxSignature());
                return Crypto.getAddress(pubKey, needBuffer);
            } catch (e) {
                logger.error(e);
            }
            return undefined;
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

            assert(this.conciliumId !== undefined, 'conciliumId undefined');

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
                return output.contractCode || output.amount > 0;
            });

            // we don't check signatures because claimProofs could be arbitrary value for codeScript, not only signatures
            assert(outsValid, 'Errors in outputs');

            assert(this.claimProofs.length === inputs.length || this.getTxSignature(), 'Errors in clamProofs');
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

        verifyCoinbase(blockFees) {
            assert(this.isCoinbase(), 'Not a coinbase TX!');
            assert(this.amountOut() === blockFees, 'Bad amount in coinbase!');
        }

        isContractCreation() {
            const outCoins = this.getOutCoins();
            return outCoins[0].getReceiverAddr().equals(Crypto.getAddrContractCreation());
        }

        /**
         * Amount of coins to transfer with this TX
         *
         * @returns {*}
         */
        amountOut() {
            return this.outputs.reduce((accum, out) => accum + out.amount, 0);
        }

        getContractCode() {
            const contractOutput = this._getContractOutput();
            return contractOutput.contractCode;
        }

        getContractAddr() {
            const contractOutput = this._getContractOutput();
            return contractOutput.receiverAddr;
        }

        getContractChangeReceiver() {
            const contractOutput = this._getContractOutput();
            return contractOutput.addrChangeReceiver;
        }

        getContractSentAmount() {
            const contractOutput = this._getContractOutput();
            return contractOutput.amount;
        }

        _getContractOutput() {
            const outputs = this.outputs;
            return outputs[0];
        }

        getSize() {
            return (transactionProto.encode(this._data).finish()).length;
        }
    };
