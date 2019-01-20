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
    const __MyRetVal={arrCode: exports.getCode(), data: exports};
    __MyRetVal;
`;
const CONTEXT_NAME = '__MyContext';

module.exports = ({Constants, Transaction, Crypto, PatchDB, Coins, TxReceipt, Contract}) =>
    class Application {
        constructor(options) {
        }

        /**
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

            // this patch will hold exec result. merge it with patchForBlock ONLY if inputs processed successfully
            const patch = new PatchDB();
            if (!patchForBlock) patchForBlock = patch;

            for (let i = 0; i < txInputs.length; i++) {

                // now it's equals txHash, but if you plan to implement SIGHASH_SINGLE & SIGHASH_NONE it will be different
                const buffInputHash = Buffer.from(tx.hash(i), 'hex');
                const input = txInputs[i];

                // input.txHash - UTXO
                const strInputTxHash = input.txHash.toString('hex');
                const utxo = patchForBlock.getUtxo(strInputTxHash) || mapUtxos[strInputTxHash];
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
         * @param {Number} nStartFromIdx - if we want to skip some outputs, for contract for example
         * @returns {Number} - Amount to spend
         */
        processPayments(tx, patch, nStartFromIdx = 0) {
            const txHash = tx.hash();

            // TODO: change "amount" from Numbers to BN or uint64 to avoid floating point issues!
            let totalSent = 0;
            const txCoins = tx.getOutCoins();

            for (let i = nStartFromIdx; i < txCoins.length; i++) {
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
         * @param {Number} coinsLimit - spend no more than this limit
         * @param {String} strCode - contract code
         * @param {Object} environment - global variables for contract (like contractAddr)
         * @returns {{receipt: TxReceipt, contract: Contract}
         */
        createContract(coinsLimit, strCode, environment) {

            const vm = new VM({
                timeout: Constants.TIMEOUT_CODE,
                sandbox: {
                    ...environment
                }
            });

            // TODO: implement fee! (wrapping contract)
            // prepend predefined classes to code
            let status;
            let contract;
            try {

                // run code (timeout could terminate code on slow nodes!! it's not good, but we don't need weak ones!)
                const retVal = vm.run(strPredefinedClassesCode + strCode + strCodeSuffix);
                assert(retVal, 'Unexpected empty result from contract constructor!');
                assert(retVal.arrCode, 'No contract methods exported!');
                assert(retVal.data, 'No contract data exported!');

                // get returned class instance with member data && exported functions
                // this will keep only data (strip proxies)
                const objData = JSON.parse(JSON.stringify(retVal.data));

                // prepare methods for storing
                const strCodeExportedFunctions = retVal.arrCode.join(Constants.CONTRACT_METHOD_SEPARATOR);

                contract = this._newContract(environment.contractAddr, objData, strCodeExportedFunctions);

                status = Constants.TX_STATUS_OK;
            } catch (err) {
                logger.error('Error while creating contract!', new Error(err));
                status = Constants.TX_STATUS_FAILED;
            }

            // TODO: create TX with change to author!
            // TODO: return Fee (see coinsUsed)
            return {
                receipt: new TxReceipt({
                    contractAddress: Buffer.from(environment.contractAddr, 'hex'),
                    coinsUsed: Constants.MIN_CONTRACT_FEE,
                    status
                }),
                contract
            };
        }

        /**
         * It will update contract in a case of success
         *
         * @param {Number} coinsLimit - spend no more than this limit
         * @param {String} strInvocationCode - code to invoke, like publicMethod(param1, param2)
         * @param {Contract} contract - contract loaded from store (@see structures/contract.js)
         * @param {Object} environment - global variables for contract (like contractAddr)
         * @param {Function} funcToLoadNestedContracts - not used yet.
         * @returns {Promise<*>}
         */
        async runContract(coinsLimit, strInvocationCode, contract, environment, funcToLoadNestedContracts) {

            // run code (timeout could terminate code on slow nodes!! it's not good, but we don't need weak ones!)
            // form context from contract data
            const vm = new VM({
                timeout: Constants.TIMEOUT_CODE,
                sandbox: {
                    ...environment,
                    [CONTEXT_NAME]: Object.assign({}, contract.getData())
                }
            });

            // TODO: implement fee! (wrapping contract)
            // this will bind code to data (assign 'this' variable)
            const strPreparedCode = this._prepareCode(contract.getCode(), strInvocationCode);

            let status;
            try {

                vm.run(strPreparedCode);
                const newContractState = vm.run(`;${CONTEXT_NAME};`);

                // TODO: send rest of moneys to receiver (which one of input?!). Possibly output for change?
                // this will keep only data (strip proxies & member functions that we inject to call like this.method)
                const objData = JSON.parse(JSON.stringify(newContractState));
                contract.updateData(objData);

                status = Constants.TX_STATUS_OK;
            } catch (err) {
                logger.error(err);
                status = Constants.TX_STATUS_FAILED;
            }

            // TODO: create TX with change to author!
            // TODO: return Fee (see coinsUsed)
            return new TxReceipt({
                coinsUsed: Constants.MIN_CONTRACT_FEE,
                status
            });
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
                    // no ';' at the end because it's a replacement for function name
                    const replacement = `const ${methodName}=${newName}.bind(${CONTEXT_NAME});function ${newName}`;

                    // replace old name with code that we prepared above
                    const preparedCode = code.replace(oldName, replacement);

                    // inject function name into context, so we could use this.methodName
                    return preparedCode + `;__MyContext['${methodName}']=${methodName};`;
                })
                .join('\n');

            return strContractCodePrepared + ';' + strInvocationCode;
        }

        /**
         *
         * @param {String | Buffer} contractAddr - address of newly created contract
         * @param {Object | Buffer} data - contract data
         * @param {String} strCodeExportedFunctions - code of contract
         * @returns {Contract}
         */
        _newContract(contractAddr, data, strCodeExportedFunctions) {
            typeforce(typeforce.oneOf('String', types.Address), contractAddr);
            typeforce(typeforce.oneOf('Buffer', 'Object'), data);

            if (Buffer.isBuffer) contractAddr = contractAddr.toString('hex');

            const contract = new Contract({
                contractCode: strCodeExportedFunctions,
                contractData: data,
                groupId: this._groupId
            });
            contract.storeAddress(contractAddr);

            return contract;
        }

    };
