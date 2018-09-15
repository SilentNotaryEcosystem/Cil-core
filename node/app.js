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
         * Throws error
         *
         * @param block
         * @returns {Promise<{}>}
         */
        async processBlock(block) {
            return {};
        }

        /**
         *
         * @param {Transaction} tx
         * @param {Object} objUtxos - keys are txHashes, values - UTXO
         * @returns {Promise<void>}
         */
        async processTx(tx, objUtxos) {
            const claimProofs = tx.claimProofs;
            const txHash = tx.hash();
            const patch = new PatchDB();
            const txInputs = tx.inputs;

            // TODO: change "amount" from Numbers to BN or uint64 to avoid floating point issues!
            let totalHash = 0;
            let totalSpend = 0;
            for (let i = 0; i < txInputs.length; i++) {

                // now it's equals txHash, but if you plan to implement SIGHASH_SINGLE & SIGHASH_NONE it will be different
                const buffInputHash = Buffer.from(tx.hash(i), 'hex');
                const input = txInputs[i];
                const strInputTxHash = input.txHash.toString('hex');
                const utxo = objUtxos[strInputTxHash];

                const coins = utxo.coinsAtIndex(input.nTxOutput);
                this._verifyClaim(coins.getCodeClaim(), claimProofs[i], buffInputHash);
                patch.spendCoins(input);
                totalHash += coins.getAmount();
            }

            const txOutputs = tx.outputs;
            for (let i = 0; i < txOutputs.length; i++) {
                const coins = new Coins(txOutputs[i].amount, txOutputs[i].codeClaim);
                patch.createCoins(txHash, i, coins);
                totalSpend += txOutputs[i].amount;
            }

            const fee = totalHash - totalSpend;
            if (fee < Constants.MIN_TX_FEE) throw new Error(`Tx ${txHash} fee ${fee} too small!`);

            return patch;
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
