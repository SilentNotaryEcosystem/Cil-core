const typeforce = require('typeforce');
const types = require('../types');
const assert = require('assert');

module.exports = ({Constants, Coins}, {txReceiptProto}) =>

    /**
     * Used for serialization in storage & MsgGetBlocks
     */
    class TxReceipt {

        /**
         *
         * @param {Array | Buffer} data
         */
        constructor(data) {
            typeforce(typeforce.oneOf('Object', 'Buffer'), data);

            if (Buffer.isBuffer(data)) {
                this._data = txReceiptProto.decode(data);
            } else {
                const errMsg = txReceiptProto.verify(data);
                if (errMsg) throw new Error(`TxReceipt: ${errMsg}`);

                this._data = txReceiptProto.create(data);
            }
        }

        /**
         *
         * @param {Object} data - raw data of this class
         * @returns {this}
         */
        static createFromData(data) {
            data.__proto__ = this.prototype;
            return data;
        }

        /**
         *
         * @param {TxReceipt} receiptToMerge
         * @returns {TxReceipt}
         */
        merge(receiptToMerge) {

            this._data.internalTxns = this._data.internalTxns.concat(receiptToMerge._data.internalTxns);
            this._data.coins = this._data.coins.concat(receiptToMerge._data.coins);

//            Scenario is following:
//            - we already have receipt for some tx
//            - and "receiptToMerge" expected to have cumulative coinsUsed
            assert(receiptToMerge.getCoinsUsed() >= this.getCoinsUsed(), 'receiptToMerge have more coinsUsed');
            this._updateCoinsUsed(receiptToMerge.getCoinsUsed());

            this.setStatus(receiptToMerge.isSuccessful() && this.isSuccessful()
                ? Constants.TX_STATUS_OK
                : Constants.TX_STATUS_FAILED
            );

            return this;
        }

        /**
         *
         * @return {String}
         */
        getContractAddress() {
            return this._data.contractAddress.toString('hex');
        }

        /**
         *
         * @return {Number}
         */
        getCoinsUsed() {
            return this._data.coinsUsed;
        }

        /**
         *
         */
        _updateCoinsUsed(nNewValue) {
            this._data.coinsUsed = nNewValue;
        }

        /**
         *
         * @return {Number}
         */
        getStatus() {
            return this._data.status;
        }

        setStatus(newStatus) {
            this._data.status = newStatus;
        }

        isSuccessful() {
            return this._data.status === Constants.TX_STATUS_OK;
        }

        /**
         *
         * @return {String}
         */
        getMessage() {
            return this._data.message;
        }

        /**
         *
         * @return {Buffer}
         */
        encode() {
            return txReceiptProto.encode(this._data).finish();
        }

        equals(receipt) {
            return this.encode().equals(receipt.encode());
        }

        /**
         *
         * @param {UTXO} utxo with only ONE COIN! @see node._createInternalTx
         */
        addInternalUtxo(utxo) {
            typeforce(types.UTXO, utxo);

            this._data.internalTxns.push(Buffer.from(utxo.getTxHash(), 'hex'));
            this._data.coins.push(utxo.coinsAtIndex(0).getRawData());
        }

        /**
         *
         * @returns {Array} of BUFFERS!
         */
        getInternalTxns() {
            return this._data.internalTxns;
        }

        /**
         *
         * @param {Buffer | String} hash - internal TX hash
         * @return {Coins}
         */
        getCoinsForTx(hash) {
            typeforce(types.Hash256bit, hash);

            hash = Buffer.isBuffer(hash) ? hash : Buffer.from(hash, 'hex');

            const idx = this._data.internalTxns.findIndex(buffHashI => buffHashI.equals(hash));
            if (!~idx) throw new Error(`"${hash.toString('hex')}" not found in receipt`);

            return Coins.createFromData(this._data.coins[idx]);
        }

        toObject() {
            return {
                ...this._data,
                contractAddress: this._data.contractAddress ? this._data.contractAddress.toString('hex') : undefined,
                internalTxns: this._data.internalTxns.map(buffHash => buffHash.toString('hex'))
            };
        }
    };
