'use strict';

const {VM} = require('vm2');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const typeforce = require('typeforce');
const debugLib = require('debug');
const types = require('../types');

const debug = debugLib('application:');

const strPredefinedClassesCode = fs.readFileSync(path.resolve(__dirname + '/../proto/predefinedClasses.js'));
const strCodeSuffix = `
    ;
    const __MyRetVal={objCode: exports.__getCode(), data: exports};
    __MyRetVal;
`;
const CONTEXT_NAME = '__MyContext';
const defaultFunctionName = '_default';

function _spendCoins(nCurrent, nAmount) {
    const nRemained = nCurrent - nAmount;
    if (nRemained < 0) throw new Error('Contract run out of coins');

    return nRemained;
}

module.exports = ({Constants, Transaction, Crypto, PatchDB, Coins, TxReceipt, Contract}) =>
    class Application {
        constructor(options) {
        }

        /**
         *
         * @param {Transaction} tx
         * @param {PatchDB} patchForBlock
         * @return {{patch: *, totalHas: number}}
         */
        processTxInputs(tx, patchForBlock) {
            const txHash = tx.hash();
            const txInputs = tx.inputs;
            const claimProofs = tx.claimProofs;

            let totalHas = 0;

            // this patch will hold exec result. merge it with patchForBlock ONLY if inputs processed successfully
            // we wouldn't modify patchForBlock!
            const patch = new PatchDB();
            if (!patchForBlock) patchForBlock || new PatchDB();

            for (let i = 0; i < txInputs.length; i++) {

                // now it's equals txHash, but if you plan to implement SIGHASH_SINGLE & SIGHASH_NONE it will be different
                const buffInputHash = Buffer.from(tx.hash(i), 'hex');
                const input = txInputs[i];

                // input.txHash - UTXO
                const strInputTxHash = input.txHash.toString('hex');
                const utxo = patchForBlock.getUtxo(strInputTxHash);
                if (!utxo) throw new Error(`UTXO for ${strInputTxHash} not found in patch`);

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
         * @returns {Number} - to send (used to calculate fee)
         */
        processPayments(tx, patch, nStartFromIdx = 0) {
            const txHash = tx.hash();

            // TODO: change "amount" from Numbers to BN or uint64 to avoid floating point issues!
            let totalSent = 0;
            const txCoins = tx.getOutCoins();

            for (let i = nStartFromIdx; i < txCoins.length; i++) {
                if (txCoins[i].getAmount() !== 0) patch.createCoins(txHash, i, txCoins[i]);
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
         * @returns {receipt: TxReceipt, contract: Contract}
         */
        createContract(coinsLimit, strCode, environment) {

            // deduce contract creation fee
            let coinsRemained = _spendCoins(coinsLimit, Constants.fees.CONTRACT_CREATION_FEE);

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
                assert(retVal.objCode, 'No contract methods exported!');
                assert(retVal.data, 'No contract data exported!');

                // get returned class instance with member data && exported functions
                // this will keep only data (strip proxies)
                const objData = JSON.parse(JSON.stringify(retVal.data));

                // strigify code
                const strCodeExportedFunctions = JSON.stringify(retVal.objCode);

                contract = this._newContract(environment.contractAddr, objData, strCodeExportedFunctions);

                const newDataSize = contract.getDataSize();
                coinsRemained = _spendCoins(
                    coinsRemained, newDataSize * Constants.fees.STORAGE_PER_BYTE_FEE
                );

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
                    coinsUsed: _spendCoins(coinsLimit, coinsRemained),
                    status
                }),
                contract
            };
        }

        /**
         * It will update contract in a case of success
         *
         * @param {Number} coinsLimit - spend no more than this limit
         * @param {Object} objInvocationCode - {method, arrArguments} to invoke
         * @param {Contract} contract - contract loaded from store (@see structures/contract.js)
         * @param {Object} environment - global variables for contract (like contractAddr)
         * @param {Object} context - within we'll execute code
         * @param {Object} objCallbacks - for sending funds & nested contract calls
         * @param {Function} objCallbacks.invokeContract
         * @param {Function} objCallbacks.createInternalTx
         * @param {Function} objCallbacks.processTx
         * @param {Boolean} isConstantCall - constant function call. we need result not TxReceipt. used only by RPC
         * @returns {Promise<TxReceipt>}
         */
        async runContract(coinsLimit, objInvocationCode, contract,
                          environment, context, objCallbacks, isConstantCall = false) {
            let coinsRemained = coinsLimit;

            // TODO: implement fee! (wrapping contract)
            // this will bind code to data (assign 'this' variable)
            const objMethods = JSON.parse(contract.getCode());

            // if code it empty - call default function.
            // No "default" - throws error, coins that sent to contract will be lost
            if (!objInvocationCode || !objInvocationCode.method || objInvocationCode.method === '') {
                objInvocationCode = {
                    method: defaultFunctionName,
                    arrArguments: []
                };
            }

            // run code (timeout could terminate code on slow nodes!! it's not good, but we don't need weak ones :))
            // if it's initial call - form context from contract data
            // for nested calls with delegatecall - we'll use parameter
            const thisContext = context || {
                ...environment,
                [CONTEXT_NAME]: Object.assign({}, contract.getData()),
                send,
                call: async (strAddress, objParams) => await callWithContext(strAddress, objParams, undefined),
                delegatecall: async (strAddress, objParams) => await callWithContext(strAddress, objParams, thisContext)
            };

            const vm = new VM({
                timeout: Constants.TIMEOUT_CODE,
                sandbox: thisContext
            });

            let status;
            let message;
            let result;
            try {

                // deduce contract creation fee
                coinsRemained = _spendCoins(coinsLimit, Constants.fees.CONTRACT_INVOCATION_FEE);

                if (!objMethods[objInvocationCode.method]) {
                    throw new Error(`Method ${objInvocationCode.method} not found`);
                }

                const strArgs = objInvocationCode.arrArguments.map(arg => JSON.stringify(arg)).join(',');
                const strPreparedCode = `
                    ${this._prepareCode(objMethods)}
                    ${objInvocationCode.method}(${strArgs});`;

                result = await vm.run(strPreparedCode);

                // all we need is result!
                if (isConstantCall) return result;

                // we shouldn't save data for delegated calls in this contract!
                if (!context) {
                    const newContractState = vm.run(`;${CONTEXT_NAME};`);
                    const prevDataSize = contract.getDataSize();

                    // this will keep only data (strip proxies & member functions that we inject to call like this.method)
                    const objData = JSON.parse(JSON.stringify(newContractState));
                    contract.updateData(objData);
                    const newDataSize = contract.getDataSize();

                    if (newDataSize - prevDataSize > 0) {
                        coinsRemained = _spendCoins(
                            coinsRemained,
                            (newDataSize - prevDataSize) * Constants.fees.STORAGE_PER_BYTE_FEE
                        );

                    }
                }

                status = Constants.TX_STATUS_OK;
            } catch (err) {
                logger.error(err);

                // if it's just call - we'r done here
                if (isConstantCall) throw err;

                status = Constants.TX_STATUS_FAILED;
                message = err.message;
            }

            // TODO: create TX with change to author!
            // TODO: return Fee (see coinsUsed)
            return new TxReceipt({
                coinsUsed: _spendCoins(coinsLimit, coinsRemained),
                status,
                message
            });

            // we need those function here, since JS can't pass variables by ref (coinsRemained)
            //________________________________________
            function send(strAddress, amount) {
                if (contract.getBalance() < amount) throw new Error('Not enough funds');
                coinsRemained = _spendCoins(coinsRemained, Constants.fees.INTERNAL_TX_FEE);
                objCallbacks.createInternalTx(strAddress, amount);
                contract.withdraw(amount);
            }

            async function callWithContext(strAddress, {method, arrArguments, coinsLimit: coinsToPass}, callContext) {
                if (typeof coinsToPass === 'number') {
                    if (coinsToPass < 0) throw new Error('coinsLimit should be positive');
                    if (coinsToPass > coinsRemained) throw new Error('Trying to pass more coins than have');
                }

                const {success, fee} = await objCallbacks.invokeContract(
                    strAddress,
                    {
                        method,
                        arrArguments,
                        coinsLimit: coinsToPass ? coinsToPass : coinsRemained,
                        environment,

                        // important!
                        context: callContext
                    }
                );
                coinsRemained = _spendCoins(coinsRemained, fee);
                return success;
            }
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
         * @param {Object} objFuncCode - keys - method names, values - code, like "{this._data++}"
         * @return {String} code of contract. just need to append invocation code
         * @private
         */
        _prepareCode(objFuncCode) {
            let arrCode = [];
            for (let methodName in objFuncCode) {

                // is it async function?
                let strAsync = '';
                if (objFuncCode[methodName].startsWith('<')) {
                    objFuncCode[methodName] = objFuncCode[methodName].substr(1);
                    strAsync = 'async ';
                }

                // temporary name
                const newName = `__MyRenamed__${methodName}`;

                // bind it to context
                // no ';' at the end because we'll append a code
                const strPrefix = `const ${methodName}=${newName}.bind(${CONTEXT_NAME});${strAsync}function ${newName}`;

                // suffix: inject function name into context, so we could use this.methodName
                const strSuffix = `;__MyContext['${methodName}']=${methodName};`;

                // add code
                arrCode.push(strPrefix + objFuncCode[methodName] + strSuffix);
            }

            return arrCode.join('\n');
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
                conciliumId: this._conciliumId
            });
            contract.storeAddress(contractAddr);

            return contract;
        }
    };
