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
         * @param {Object} mapUtxos - keys are txHashes, values - UTXO
         * @param {PatchDB} patchForBlock - for processing whole block we'll use same patch
         *                  (if this function fails for even for one TX in block - whole block invalid, patch unusable
         *                  so there is no need to use separate patches, or use transaction-like behavior)
         * @param {Boolean} isGenezis - do we process tx from Genezis block (no inputs)
         * @returns {Promise<{patch, fee}>}
         */
        async processTx(tx, mapUtxos, patchForBlock, isGenezis = false) {
            const txHash = tx.hash();
            const patch = patchForBlock ? patchForBlock : new PatchDB();

            // TODO: change "amount" from Numbers to BN or uint64 to avoid floating point issues!
            let totalHas = 0;
            let totalSpend = 0;
            if (!isGenezis) {
                const txInputs = tx.inputs;
                const claimProofs = tx.claimProofs;
                for (let i = 0; i < txInputs.length; i++) {

                    // now it's equals txHash, but if you plan to implement SIGHASH_SINGLE & SIGHASH_NONE it will be different
                    const buffInputHash = Buffer.from(tx.hash(i), 'hex');
                    const input = txInputs[i];
                    const strInputTxHash = input.txHash.toString('hex');
                    const utxo = patch.getUtxo(strInputTxHash) || mapUtxos[strInputTxHash];
                    if (!utxo) throw new Error(`UTXO not found for ${strInputTxHash} neither in patch nor in mapUtxos`);

                    const coins = utxo.coinsAtIndex(input.nTxOutput);
                    this._verifyClaim(coins.getCodeClaim(), claimProofs[i], buffInputHash);
                    patch.spendCoins(utxo, input.nTxOutput);
                    totalHas += coins.getAmount();
                }
            }

            const txCoins = tx.getCoins();
            for (let i = 0; i < txCoins.length; i++) {
                patch.createCoins(txHash, i, txCoins[i]);
                totalSpend += txCoins[i].getAmount();
            }

            const fee = totalHas - totalSpend;
            return {patch, fee};
        }

        _verifyClaim(codeClaim, claimProofs, buffHash) {

            // TODO: immplement custom code exec here. Now only pay2address
            this._verifyPayToAddr(codeClaim, claimProofs, buffHash);
        }

        _verifyPayToAddr(address, signature, buffHash) {
            typeforce(typeforce.tuple(types.Address, types.Signature, types.Hash256bit), arguments);

            const pubKey = Crypto.recoverPubKey(buffHash, signature);
            if (!address.equals(Crypto.getAddress(pubKey, true))) throw new Error('Claim failed!');
        }
    };
