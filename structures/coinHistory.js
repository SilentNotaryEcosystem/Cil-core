const typeforce = require('typeforce');
const types = require('../types');

module.exports = () =>
    class CoinHistory {
        constructor() {
            this._mapTxns = new Map();
        }

        recordReceive(txHash, nVout, coins) {
            typeforce(types.Str64, txHash);

            const arrCoins = this._ensureTxRecord(txHash);
            arrCoins.push([coins.getReceiverAddr(), coins.getAmount(), nVout]);
        }

        mergeHistory(cHistory) {
            const cResultHistory = new CoinHistory();

            // because we record only "received coins", it's impossible to have same TX hash
            // but different records stored inside (patch didn't merged while processing single TX)
            // so if we have same TX hash, we have same content
            cResultHistory._mapTxns = new Map([...Array.from(this._mapTxns), ...Array.from(cHistory._mapTxns)]);
            return cResultHistory;
        }

        purgeHistory(cHistory) {

            // If you plan to records "spended coins" - this SHOULD be reviewed!
            for (let [txHash] of cHistory._mapTxns) {
                this._mapTxns.delete(txHash);
            }
        }

        _ensureTxRecord(strTxHash) {
            if (!this._mapTxns.has(strTxHash)) this._mapTxns.set(strTxHash, []);
            return this._mapTxns.get(strTxHash);
        }

        [Symbol.iterator]() {
            return this._mapTxns[Symbol.iterator]();
        }
    };
