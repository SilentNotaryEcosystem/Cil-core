'use strict';

const fs = require('fs');
const path = require('path');
const typeforce = require('typeforce');
const debugLib = require('debug');

const types = require('../types');

const debug = debugLib('localTxns:');

// It's a TXns received by RPC
// we should retransmit them periodically, since mempool can purge it

module.exports = ({Constants, Transaction}) =>
    class LocalTxns {
        constructor(options = {}) {
            const {dbPath} = options;

            this._fileName = path.resolve(dbPath || Constants.DB_PATH_PREFIX, Constants.LOCAL_TX_FILE_NAME);
            this._mapTxns = new Map();

            this._loadFromDisk();
        }

        addTx(tx) {
            typeforce(types.Transaction, tx);

            this._mapTxns.set(tx.getHash(), tx);
            this._dumpToDisk();
        }

        hasTx(txHash) {
            typeforce(types.Hash256bit, txHash);

            let strTxHash = Buffer.isBuffer(txHash) ? txHash.toString('hex') : txHash;
            return !!this._mapTxns.get(strTxHash);
        }

        getTx(txHash) {
            typeforce(types.Hash256bit, txHash);

            let strTxHash = Buffer.isBuffer(txHash) ? txHash.toString('hex') : txHash;
            const tx = this._mapTxns.get(strTxHash);
            if (!tx) throw new Error(`LocalTxns: No tx found by hash ${strTxHash}`);

            return tx;
        }

        removeTx(strTxHash, bSuppressDump = false) {
            typeforce(types.Str64, strTxHash);

            if (this._mapTxns.delete(strTxHash) && !bSuppressDump) this._dumpToDisk();
        }

        removeForBlock(arrStrHashes) {
            const prevSize = this._mapTxns.size;
            arrStrHashes.forEach(strHash => this.removeTx(strHash, true));
            if (prevSize !== this._mapTxns.size) this._dumpToDisk();
        }

        getAllTxnHashes() {
            return [...this._mapTxns.keys()];
        }

        _dumpToDisk() {
            debug('Dumping to disk');
            const objToSave = {};
            for (let [txHash, tx] of this._mapTxns) {
                objToSave[txHash] = tx.encode().toString('hex');
            }

            fs.writeFileSync(this._fileName, JSON.stringify(objToSave, undefined, 2));
        }

        _loadFromDisk() {
            try {
                const objTxns = JSON.parse(fs.readFileSync(this._fileName, 'utf8'));
                for (let strHash of Object.keys(objTxns)) {
                    this._mapTxns.set(strHash, new Transaction(Buffer.from(objTxns[strHash], 'hex')));
                }
            } catch (e) {
                if (!e.message.match(/ENOENT/)) logger.error(e);
            }
        }
    };
