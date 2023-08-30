'use strict';

const {VM} = require('vm2');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const typeforce = require('typeforce');
const debugLib = require('debug');
const util = require('util');
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
                if (!utxo) throw new Error(`UTXO ${strInputTxHash} of ${txHash} not found in patch`);

                const coins = utxo.coinsAtIndex(input.nTxOutput);

                // Verify coins possession
                const claimProof = Array.isArray(claimProofs) && claimProofs.length
                    ? claimProofs[i]
                    : tx.getTxSignature();
                this._verifyPayToAddr(coins.getReceiverAddr(), claimProof, buffInputHash);

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
         * @param {String} strCode - contract code
         * @param {Object} environment - global variables for contract (like contractAddr)
         * @param {Number} nContractVersion - @see contract constructor
         * @returns {contract}
         */
        createContract(strCode, environment, nContractVersion) {
            typeforce(typeforce.tuple(typeforce.String, typeforce.Object), arguments);

            this._execStarted();

            const vm = new VM({
                timeout: Constants.TIMEOUT_CODE,
                sandbox: {
                    ...environment
                }
            });

            this._nCoinsLimit = _spendCoins(this._nCoinsLimit, this._objFees.nFeeContractCreation);

            // prepend predefined classes to code
            let status;
            let contract;
            let message;

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

                contract =
                    this._newContract(environment.contractAddr, objData, strCodeExportedFunctions, nContractVersion);

            } finally {
                this._execDone(contract);
            }

            return contract;
        }

        /**
         *
         * @param objVariables
         */
        setupVariables(objVariables) {
            const {coinsLimit, objFees} = objVariables;

            this._objFees = objFees;
            this._nInitialCoins = this._nCoinsLimit = coinsLimit;

            this._nDataDelta = 0;
            this._arrContractDataSize = [];
            this._arrContracts = [];
        }

        /**
         *
         * @param {Object} objCallbacks - for sending funds & nested contract calls
         * @param {Function} objCallbacks.invokeContract
         * @param {Function} objCallbacks.createInternalTx         */
        setCallbacks(objCallbacks) {
            this._objCallbacks = objCallbacks;
        }

        /**
         * It will update contract in a case of success
         *
         * @param {Object} objInvocationCode - {method, arrArguments} to invoke
         * @param {Contract} contract - contract loaded from store (@see structures/contract.js)
         * @param {Object} environment - global variables for contract (like contractAddr)
         * @param {Object} context - within we'll execute code, contain: contractData, global functions, environment
         * @param {Boolean} isConstantCall - constant function call. we need result not TxReceipt. used only by RPC
         * @returns {Promise<result>}
         */
        async runContract(objInvocationCode, contract, environment, context = undefined, isConstantCall = false) {
            typeforce(
                typeforce.tuple(
                    typeforce.Object,
                    types.Contract,
                    typeforce.Object
                ),
                arguments
            );

            this._execStarted(contract);

            const {nFeeContractInvocation, nFeeStorage} = this._objFees;

            let status;
            let message;
            let result;

            try {
                debug(`Invoking ${util.inspect(objInvocationCode, {colors: true, depth: null})}`);

                // deduce contract invocation fee
                this._nCoinsLimit = _spendCoins(this._nCoinsLimit, nFeeContractInvocation);

                // this will bind code to data (assign 'this' variable)
                const objMethods = contract.getCode();

                // if code it empty - call default function.
                // No "default" - throws error
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
                    send: (strAddress, amount) => this._send(strAddress, amount),
                    call: async (strAddress, objParams) => await this._callWithContext(
                        strAddress,
                        objParams,
                        undefined,
                        environment
                    ),
                    delegatecall: async (strAddress, objParams) => await this._callWithContext(
                        strAddress,
                        objParams,
                        thisContext,
                        environment
                    ),
                    sha3: (message) => Crypto.sha3(message)
                };

                const vm = new VM({
                    timeout: Constants.TIMEOUT_CODE,
                    sandbox: thisContext
                });

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

                    // this will keep only data (strip proxies & member functions that we inject to call like this.method)
                    const objData = JSON.parse(JSON.stringify(newContractState));
                    contract.updateData(objData);
                }
            } finally {
                this._execDone(contract);
            }

            return result;
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
         * @param {Number} nContractVersion - @see contract constructor
         * @returns {Contract}
         */
        _newContract(contractAddr, data, strCodeExportedFunctions, nContractVersion) {
            typeforce(typeforce.oneOf('String', types.Address), contractAddr);
            typeforce(typeforce.oneOf('Buffer', 'Object'), data);

            if (Buffer.isBuffer) contractAddr = contractAddr.toString('hex');

            const contract = new Contract({
                contractCode: strCodeExportedFunctions,
                contractData: data
            }, contractAddr, nContractVersion);

            return contract;
        }

        _send(strAddress, amount) {

            // if it will throw (not enough) - no assignment will be made
            this._nCoinsLimit = _spendCoins(this._nCoinsLimit, this._objFees.nFeeInternalTx);
            this._objCallbacks.sendCoins(strAddress, amount, this._getCurrentContract());
        }

        async _callWithContext(
            strAddress,
            {method, arrArguments, coinsLimit: coinsToPass},
            callContext,
            environment
        ) {
            if (typeof coinsToPass === 'number') {
                if (coinsToPass < 0) throw new Error('coinsLimit should be positive');
                if (coinsToPass > this._nCoinsLimit) throw new Error('Trying to pass more coins than have');
            }

            const result = await this._objCallbacks.invokeContract(
                strAddress,
                {
                    method,
                    arrArguments,
                    coinsLimit: coinsToPass ? coinsToPass : this._nCoinsLimit,
                    environment,

                    // important!
                    context: callContext
                },
                this._getCurrentContract()
            );

            // all fees for nested contract will be handled by it
            return result;
        }

        coinsSpent() {
            return this._nInitialCoins - this._nCoinsLimit;
        }

        getDataDelta() {
            return this._nDataDelta;
        }

        _execStarted(contract) {
            if (!this._arrContractDataSize) throw new Error('App. Uninitialized variables, or recursion error');

            this._arrContractDataSize.push(contract ? contract.getDataSize() : 0);
            this._arrContracts.push(contract);
        }

        _execDone(contract) {
            if (!this._arrContractDataSize.length) throw new Error('App. Recursion error');

            this._arrContracts.pop();

            const nPrevDataSize = this._arrContractDataSize.pop();
            if (contract) this._nDataDelta += contract.getDataSize() - nPrevDataSize;

            if (!this._arrContractDataSize.length) this._arrContractDataSize = undefined;
        }

        _getCurrentContract() {
            return this._arrContracts[this._arrContracts.length - 1];
        }
    };
