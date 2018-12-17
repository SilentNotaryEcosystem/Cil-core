'use strict';

const {VM} = require('vm2');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const typeforce = require('typeforce');
const debugLib = require('debug');
const {sleep} = require('../utils');
const types = require('../types');

const debug = debugLib('application:');

const strPredefinedClassesCode = fs.readFileSync(path.resolve(__dirname + '/../proto/predefinedClasses.js'));
const strCodeSuffix = `
    ;
    const __MyRetVal={methods: exports.getMethods(), data: exports};
    __MyRetVal;
`;

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
         * 1. All classes should be derived from Base (or redefine export() - to return all function needed by contract
         * 2. Last code line - is creating instance of contract class
         * 3. Contract invocation - string. like functionName(...params)
         *
         * @param {Transaction} tx - transaction with contract code
         * @param {PatchDB} patch - to store new contract & receipt
         */
        createContract(tx, patch) {
            const strCode = tx.getCode();

            // run code (timeout could terminate code on slow nodes!! it's not good, but we don't need weak ones!)
            const vm = new VM({
                timeout: Constants.TIMEOUT_CODE,
                sandbox: {}
            });

            // TODO: implement fee! (wrapping contract)
            // prepend predefined classes to code
            const retVal = vm.run(strPredefinedClassesCode + strCode + strCodeSuffix);
            assert(retVal, 'Unexpected empty result from contract constructor!');
            assert(retVal.methods, 'No contract methods exported!');
            assert(retVal.data, 'No contract data exported!');

            // get returned class instance with member data && exported functions
            const objData = Object.assign({}, retVal.data);

            const strCodeExportedFunctions = retVal.methods
                .map(strFuncName => retVal.data[strFuncName].toString())
                .join(Constants.CONTRACT_METHOD_SEPARATOR);

            // generate address for new contract
            const contractAddr = Crypto.getAddress(tx.hash());

            // save receipt & data & functions code to patch
            patch.setContract(contractAddr, objData, strCodeExportedFunctions);

            // TODO: create TX with change to author!
            // TODO: return Fee
            return 0;
        }

        async runContract(strInvocationCode, patch, contract, funcToLoadNestedContracts) {
            const CONTEXT_NAME = '__MyContext';

            // run code (timeout could terminate code on slow nodes!! it's not good, but we don't need weak ones!)
            // form context from contract data
            const vm = new VM({
                timeout: Constants.TIMEOUT_CODE,
                sandbox: {
                    [CONTEXT_NAME]: Object.assign({}, contract.getData())
                }
            });

            // TODO: implement fee! (wrapping contract)
            const strPreparedCode = this._prepareCode(contract.getCode(), strInvocationCode);
            vm.run(strPreparedCode);
            const newContractState = vm.run(`;${CONTEXT_NAME};`);

            // TODO: create receipt here
            // TODO: send rest of moneys to receiver (which one of input?!). Possibly output for change?
            const objData = Object.assign({}, newContractState);

            // save receipt & data & functions code to patch
            patch.setContract(contract.getStoredAddress(), objData);
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

        /**
         *
         * @param {String} strContractCode - code we saved from contract constructor joined by '\0'
         * @param {String} strInvocationCode - method invocation
         * @return {String} code ready to be executed
         * @private
         */
        _prepareCode(strContractCode, strInvocationCode) {
            const arrMethodCode = strContractCode.split(Constants.CONTRACT_METHOD_SEPARATOR);

            const strContractCodePrepared = arrMethodCode
                .map(code => {

                    // get method name from code
                    const [, methodName] = code.match(/^(.+)\(/);
                    const oldName = new RegExp('^' + methodName);

                    // temporary name
                    const newName = `__MyRenamed__${methodName}`;

                    // bind it to context
                    const replacement = `const ${methodName}=${newName}.bind(__MyContext);function ${newName}`;

                    // replace old name with new code
                    return code.replace(oldName, replacement);
                })
                .join('\n');

            return strContractCodePrepared + ';' + strInvocationCode;
        }
    };
