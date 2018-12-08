'use strict';

const typeforce = require('typeforce');
const debugLib = require('debug');
const {sleep} = require('../utils');
const types = require('../types');

const debug = debugLib('application:');

module.exports = ({Constants, Transaction, Crypto, PatchDB, Coins}) =>
    class Application {
        constructor(options) {
        }

        /**
         * TODO: lock DB for all UTXO with mutex right after forming mapUtxos and release it after applying patch or UTXO DB could be corrupted!
         *
         * @param {Transaction} tx
         * @param {Map} mapUtxos
         * @param {PatchDB} patchForBlock
         * @return {{patch: *, totalHas: number}}
         */
        processTxInputs(tx, mapUtxos, patchForBlock) {
            const txHash = tx.hash();
            const txInputs = tx.inputs;
            const claimProofs = tx.claimProofs;

            let totalHas = 0;
            const patch = patchForBlock ? patchForBlock : new PatchDB();

            for (let i = 0; i < txInputs.length; i++) {

                // now it's equals txHash, but if you plan to implement SIGHASH_SINGLE & SIGHASH_NONE it will be different
                const buffInputHash = Buffer.from(tx.hash(i), 'hex');
                const input = txInputs[i];

                // input.txHash - UTXO
                const strInputTxHash = input.txHash.toString('hex');
                const utxo = patch.getUtxo(strInputTxHash) || mapUtxos[strInputTxHash];
                if (!utxo) throw new Error(`UTXO not found for ${strInputTxHash} neither in patch nor in mapUtxos`);

                const coins = utxo.coinsAtIndex(input.nTxOutput);

                // Verify coins possession
                this._verifyPayToAddr(coins.getReceiverAddr(), claimProofs[i], buffInputHash);

                // spend it
                patch.spendCoins(utxo, input.nTxOutput, txHash);

                // count sum of all inputs
                totalHas += coins.getAmount();
            }

            return {patch, totalHas};
        }

        /**
         * @param {Transaction} tx
         * @param {PatchDB} patch - to create new coins
         * @returns {Number} - Amount to spend
         */
        processPayments(tx, patch) {
            const txHash = tx.hash();

            // TODO: change "amount" from Numbers to BN or uint64 to avoid floating point issues!
            let totalSent = 0;
            const txCoins = tx.getOutCoins();

            for (let i = 0; i < txCoins.length; i++) {
                patch.createCoins(txHash, i, txCoins[i]);
                totalSent += txCoins[i].getAmount();
            }

            return totalSent;
        }

        /**
         *
         * @param {Buffer} address - receiver address
         * @param {Buffer} signature - provided by receiver to prove ownership
         * @param {Buffer} buffSignedData - data that was signed (need to verify or recover signature)
         * @private
         */
        _verifyPayToAddr(address, signature, buffSignedData) {
            typeforce(typeforce.tuple(types.Address, types.Signature, types.Hash256bit), arguments);

            const pubKey = Crypto.recoverPubKey(buffSignedData, signature);
            if (!address.equals(Crypto.getAddress(pubKey, true))) throw new Error('Claim failed!');
        }
    };
