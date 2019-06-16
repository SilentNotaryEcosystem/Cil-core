const typeforce = require('typeforce');
const types = require('../types');

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
                this._data = txReceiptProto.create(data);
            }
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
         * @param {UTXO} utxo
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
