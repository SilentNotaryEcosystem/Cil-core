'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');

const factory = require('../testFactory');
const {pseudoRandomBuffer, generateAddress, createObjInvocationCode} = require('../testUtil');

describe('Contract integration tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should NOT DEPLOY contract (constructor throws)', async () => {
        const nCoinsIn = 1e5;
        const node = new factory.Node();
        const patchTx = new factory.PatchDB();
        const contractCode = `
            class TestContract extends Base{
                constructor(answer) {
                    super();
                    this._someData=answer;
                    throw (1);
                }
            };

            exports=new TestContract(42);
            `;
        const tx = factory.Transaction.createContract(contractCode, generateAddress());

        await node._processContract(false, undefined, tx, patchTx, new factory.PatchDB(), nCoinsIn);

        const receipt = patchTx.getReceipt(tx.hash());
        assert.isOk(receipt);
        assert.isNotOk(receipt.isSuccessful());

        // despite terminated invocation we should send fee to miner and send change to invoker
        assert.isOk(receipt.getCoinsUsed() > 0);
        assert.isNotOk(patchTx.getContract(receipt.getContractAddress()));
        assert.equal(receipt.getInternalTxns().length, 1);
        const [changeTxHash] = receipt.getInternalTxns();
        assert.isOk(changeTxHash);
        const changeUxo = patchTx.getUtxo(changeTxHash);
        assert.isOk(changeUxo);
        assert.equal(changeUxo.amountOut(), nCoinsIn - factory.Constants.fees.CONTRACT_FEE);

        // no UTXO created for transferred coins
        assert.isNotOk(patchTx.getUtxo(tx.getHash()));
    });

    it('should deploy contract', async () => {
        const nCoinsIn = 1e5;
        const node = new factory.Node();
        const patchTx = new factory.PatchDB();
        const contractCode = `
            class TestContract extends Base{
                constructor(answer) {
                    super();
                    this._someData=answer;
                }
            };

            exports=new TestContract(42);
            `;
        const tx = factory.Transaction.createContract(contractCode, generateAddress());

        await node._processContract(false, undefined, tx, patchTx, new factory.PatchDB(), nCoinsIn);

        const receipt = patchTx.getReceipt(tx.hash());
        assert.isOk(receipt);
        assert.isOk(receipt.isSuccessful());
        assert.isOk(receipt.getCoinsUsed() > 0);
        const contract = patchTx.getContract(receipt.getContractAddress());
        assert.isOk(contract);
        assert.deepEqual(contract.getData(), {_someData: 42});
        assert.equal(receipt.getInternalTxns().length, 1);
        const [changeTxHash] = receipt.getInternalTxns();
        assert.isOk(changeTxHash);
        const changeUxo = patchTx.getUtxo(changeTxHash);
        assert.isOk(changeUxo);
        assert.equal(changeUxo.amountOut(), nCoinsIn - factory.Constants.fees.CONTRACT_FEE);

        // no UTXO created for transferred coins
        assert.isNotOk(patchTx.getUtxo(tx.getHash()));
    });

    it('should TERMINATE contract INVOCATION (throws error)', async () => {
        const nCoinsIn = 1e5;
        const node = new factory.Node();
        const patchTx = new factory.PatchDB();

        const contractCode = `
            class TestContract extends Base{
                constructor(answer) {
                    super();
                    this._someData=answer;
                }
                someFunction(){
                    throw(1);
                }
            };

            exports=new TestContract(42);
            `;
        const tx = factory.Transaction.createContract(contractCode, generateAddress());
        let contract;

        // deploy contract and check success
        await node._processContract(false, undefined, tx, patchTx, new factory.PatchDB(), nCoinsIn);

        {
            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());
            assert.isOk(receipt.getCoinsUsed() > 0);

            contract = patchTx.getContract(receipt.getContractAddress());
            assert.isOk(contract);
        }

        // call for it
        const objCodeToRun = createObjInvocationCode('someFunction', []);
        const txRun = factory.Transaction.invokeContract(
            contract.getStoredAddress(),
            objCodeToRun,
            0,
            generateAddress()
        );
        const patchRun = new factory.PatchDB();

        await node._processContract(false, contract, txRun, patchRun, new factory.PatchDB(), nCoinsIn);

        {
            const receipt = patchRun.getReceipt(txRun.hash());
            assert.isOk(receipt);
            assert.isNotOk(receipt.isSuccessful());

            // despite terminated invocation we should send fee to miner and send change to invoker
            assert.isOk(receipt.getCoinsUsed() > 0);
            assert.isNotOk(patchRun.getContract(receipt.getContractAddress()));

            // balance of contract is unchanged
            assert.equal(contract.getBalance(), 0);

            assert.equal(receipt.getInternalTxns().length, 1);
            const [changeTxHash] = receipt.getInternalTxns();
            assert.isOk(changeTxHash);
            const changeUxo = patchRun.getUtxo(changeTxHash);
            assert.isOk(changeUxo);
            assert.equal(changeUxo.amountOut(), nCoinsIn - factory.Constants.fees.CONTRACT_FEE);

            // no UTXO created for transferred coins
            assert.isNotOk(patchRun.getUtxo(tx.getHash()));
        }
    });

    it('should process block with subsequent contract invocation', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        const strContractAddr = generateAddress().toString('hex');
        const tx1 = factory.Transaction.invokeContract(
            strContractAddr,
            createObjInvocationCode('add', [10]),
            100,
            undefined
        );
        const tx2 = factory.Transaction.invokeContract(
            strContractAddr,
            createObjInvocationCode('add', [100]),
            100,
            undefined
        );

        // tx1 & tx2 created with witnessGroupId 0
        const block = new factory.Block(0);
        block.addTx(tx1);
        block.addTx(tx2);
        block.finish(0, pseudoRandomBuffer(33));

        node.isGenesisBlock = () => true;
        node._pendingBlocks.mergePatches = () => new factory.PatchDB();
        node._storage.getContract = () => new factory.Contract({
            groupId: 0,
            contractCode: '{"add": "(a){this.value+=a;}"}',
            contractData: {value: 23}
        }, strContractAddr);

        const patchState = await node._execBlock(block);
        assert.isOk(patchState);
        const patchContract = patchState.getContract(strContractAddr);
        assert.isOk(patchContract);
        assert.deepEqual(patchContract.getData(), {value: 133});
    });

    it('should INVOKE CONTRACT with EMPTY CODE when transferring moneys to contract', async () => {
        const buffContractAddr = generateAddress();

        const node = new factory.Node();
        await node.ensureLoaded();
        node._app.runContract = sinon.fake.returns(new factory.TxReceipt({}));

        const patch = new factory.PatchDB();
        patch.getContract = () => new factory.Contract({}, buffContractAddr.toString('hex'));

        const tx = new factory.Transaction();
        tx.addReceiver(1000, buffContractAddr);

        await node._processTx(patch, true, tx);

        assert.isOk(node._app.runContract.calledOnce);
        const [, invocationCode] = node._app.runContract.args[0];
        assert.deepEqual(invocationCode, {});
    });

    it('should process block with subsequent contract invocation (via transfer)', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        const buffContractAddr = generateAddress();
        const strContractAddr = buffContractAddr.toString('hex');
        const tx1 = new factory.Transaction();
        tx1.addReceiver(1000, buffContractAddr);

        const tx2 = new factory.Transaction();
        tx2.addReceiver(3000, buffContractAddr);

        // tx1 & tx2 created with witnessGroupId 0
        const block = new factory.Block(0);
        block.addTx(tx1);
        block.addTx(tx2);
        block.finish(0, pseudoRandomBuffer(33));

        node.isGenesisBlock = () => true;
        node._pendingBlocks.mergePatches = () => new factory.PatchDB();
        node._storage.getContract = () => new factory.Contract({
            groupId: 0,
            contractCode: '{"_default": "(){}"}'
        }, strContractAddr);

        const patchState = await node._execBlock(block);
        assert.isOk(patchState);
        const contractPatch = patchState.getContract(strContractAddr);
        assert.isOk(contractPatch);
        assert.equal(contractPatch.getBalance(), 4000);
    });

    it('should DEPLOY & INVOKE contract & test GLOBAL VARIABLES', async () => {
        const nCoinsIn = 1e5;
        const node = new factory.Node();
        const patchTx = new factory.PatchDB();

        const nCoinsSentToContract = 1e3;
        const kp = factory.Crypto.createKeyPair();

        const contractCode = `
            class TestContract extends Base{
                constructor(answer) {
                    super();
                    this._ownerAddress = callerAddress;
                    this._contractAddr = contractAddr;
                    this._someData=answer;
                }
                
                testVariables() {
                    this._testResult= this._ownerAddress === callerAddress && this._contractAddr === contractAddr;
                }
            };

            exports=new TestContract(42);
            `;
        const tx = factory.Transaction.createContract(contractCode, generateAddress());
        tx.signForContract(kp.privateKey);

        // deploy contract and check success
        await node._processContract(false, undefined, tx, patchTx, new factory.PatchDB(), nCoinsIn);

        let contract;
        {
            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());
            assert.isOk(receipt.getCoinsUsed() > 0);

            contract = patchTx.getContract(receipt.getContractAddress());
            assert.isOk(contract);

            assert.equal(contract.getData()._ownerAddress, kp.address);
            assert.equal(contract.getData()._contractAddr, receipt.getContractAddress());
        }

        const contractDataSize = contract.getDataSize();

        // call for it
        const objCodeToRun = createObjInvocationCode('testVariables', []);
        const txRun = factory.Transaction.invokeContract(
            contract.getStoredAddress(),
            objCodeToRun,
            nCoinsSentToContract,
            generateAddress()
        );
        txRun.signForContract(kp.privateKey);

        const patchRun = new factory.PatchDB();

        await node._processContract(false, contract, txRun, patchRun, new factory.PatchDB(), nCoinsIn);
        {
            const receipt = patchRun.getReceipt(txRun.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());
            assert.isOk(receipt.getCoinsUsed() > 0);

            assert.isOk(patchRun.getContract(contract.getStoredAddress()));

            // balance had changed
            assert.equal(contract.getBalance(), nCoinsSentToContract);

            // variable tested
            assert.isOk(contract.getData()._testResult);

            // change transferred as internal TX
            assert.equal(receipt.getInternalTxns().length, 1);
            const [changeTxHash] = receipt.getInternalTxns();
            assert.isOk(changeTxHash);
            const changeUxo = patchRun.getUtxo(changeTxHash);
            assert.isOk(changeUxo);
            const expectedChange = nCoinsIn -
                                   factory.Constants.fees.CONTRACT_FEE -
                                   (contract.getDataSize() - contractDataSize) *
                                   factory.Constants.fees.STORAGE_PER_BYTE_FEE;

            assert.equal(changeUxo.amountOut(), expectedChange);

            // no UTXO created for transferred coins
            assert.isNotOk(patchRun.getUtxo(tx.getHash()));

        }
    });

    describe('Send moneys from contract', () => {
        let node;
        let contract;
        const contractBalance = 1e4;
        const strAddress = generateAddress().toString('hex');
        let env;

        beforeEach(async () => {
            node = new factory.Node();
            await node.ensureLoaded();

            const strContractAddr = generateAddress().toString('hex');
            contract = new factory.Contract({
                balance: contractBalance,
                contractCode: `{"test": "(strAddr, amount){send(strAddr, amount)}"}`
            }, strContractAddr);

            env = {
                contractTx: undefined,
                callerAddress: undefined,
                contractAddr: strContractAddr,
                balance: contractBalance
            };
        });

        it('should FAIL (not enough moneys)', async () => {
            const coinsLimit = factory.Constants.fees.CONTRACT_FEE + factory.Constants.fees.INTERNAL_TX_FEE;
            const txReceipt = await node._app.runContract(
                coinsLimit,
                createObjInvocationCode('test', [strAddress, contractBalance + 1]),
                contract,
                env,
                undefined,
                node._createCallbacksForApp()
            );
            assert.isOk(txReceipt instanceof factory.TxReceipt);
            assert.isNotOk(txReceipt.isSuccessful());
            assert.equal(txReceipt.getMessage(), 'Not enough funds');
        });

        it('should FAIL (not enough coins to perform send)', async () => {
            const coinsLimit = factory.Constants.fees.CONTRACT_FEE + factory.Constants.fees.INTERNAL_TX_FEE;
            const txReceipt = await node._app.runContract(
                coinsLimit - 1,
                createObjInvocationCode('test', [strAddress, contractBalance]),
                contract,
                env,
                undefined,
                node._createCallbacksForApp()
            );
            assert.isOk(txReceipt instanceof factory.TxReceipt);
            assert.isNotOk(txReceipt.isSuccessful());
            assert.equal(txReceipt.getMessage(), 'Contract run out of coins');
        });

        it('should Success', async () => {
            const coinsLimit = factory.Constants.fees.CONTRACT_FEE + factory.Constants.fees.INTERNAL_TX_FEE;
            const strThisTxHash = pseudoRandomBuffer().toString('hex');
            const patchTx = new factory.PatchDB();
            const txReceipt = await node._app.runContract(
                coinsLimit,
                createObjInvocationCode('test', [strAddress, contractBalance]),
                contract,
                env,
                undefined,
                node._createCallbacksForApp(undefined, patchTx, strThisTxHash)
            );

            assert.isOk(txReceipt instanceof factory.TxReceipt);
            assert.isOk(txReceipt.isSuccessful());

            patchTx.setReceipt(strThisTxHash, txReceipt);
            patchTx.setContract(contract);

            const receipt = patchTx.getReceipt(strThisTxHash);

            const arrInternalTxns = [...receipt.getInternalTxns()];
            assert.equal(arrInternalTxns.length, 1);
        });
    });

    describe('Nested contract calls', () => {
        let node;
        let contract;
        const strAddress = generateAddress().toString('hex');
        let env;

        beforeEach(async () => {
            node = new factory.Node();
            await node.ensureLoaded();

            const objCode = {
                "test": "<(strAddress, method, ...arrArguments){await call(strAddress, {method, arrArguments})}"
            };
            contract = new factory.Contract({
                contractCode: JSON.stringify(objCode)
            });

            env = {
                contractTx: undefined,
                callerAddress: undefined,
                contractAddr: undefined,
                balance: 0
            };
        });

        it('should FAIL to call (not enough coins to perform)', async () => {
            const coinsLimit = factory.Constants.fees.CONTRACT_FEE;
            const txReceipt = await node._app.runContract(
                coinsLimit - 1,
                createObjInvocationCode('test', [strAddress, 'test', 1, 2, 3, 4]),
                contract,
                env,
                undefined,
                node._createCallbacksForApp()
            );
            assert.isOk(txReceipt instanceof factory.TxReceipt);
            assert.isNotOk(txReceipt.isSuccessful());
            assert.equal(txReceipt.getMessage(), 'Contract run out of coins');
        });

        it('should FAIL to call (trying to pass more coins than have)', async () => {
            const coinsLimit = 2 * factory.Constants.fees.CONTRACT_FEE;

            contract = new factory.Contract({
                contractCode: `{"test": "<(strAddress, method, ...arrArguments){await call(strAddress, {method, arrArguments, coinsLimit: ${coinsLimit}})}"}`
            });

            console.log(contract.getCode());

            const txReceipt = await node._app.runContract(
                coinsLimit,
                createObjInvocationCode('test', [strAddress, 'test', 1, 2, 3, 4]),
                contract,
                env,
                undefined,
                node._createCallbacksForApp()
            );
            assert.isOk(txReceipt instanceof factory.TxReceipt);
            assert.isNotOk(txReceipt.isSuccessful());
            assert.equal(txReceipt.getMessage(), 'Trying to pass more coins than have');
        });

        it('should FAIL to call (trying to pass negative coinsLimit)', async () => {
            const coinsLimit = 2 * factory.Constants.fees.CONTRACT_FEE;

            contract = new factory.Contract({
                contractCode: `{"test": "<(strAddress, method, ...arrArguments){await call(strAddress, {method, arrArguments, coinsLimit: -1})}"}`
            });

            console.log(contract.getCode());

            const txReceipt = await node._app.runContract(
                coinsLimit,
                createObjInvocationCode('test', [strAddress, 'test', 1, 2, 3, 4]),
                contract,
                env,
                undefined,
                node._createCallbacksForApp()
            );
            assert.isOk(txReceipt instanceof factory.TxReceipt);
            assert.isNotOk(txReceipt.isSuccessful());
            assert.equal(txReceipt.getMessage(), 'coinsLimit should be positive');
        });

        it('should SUCCESSFULLY "call" nested contract with nested send', async () => {
            const coinsLimit = 3 * factory.Constants.fees.CONTRACT_FEE + factory.Constants.fees.INTERNAL_TX_FEE;

            const strReceiver = generateAddress().toString('hex');
            const objCode = {
                "test": `<(strAddress){
                            const success=await call(strAddress, {method: "testAnother", arrArguments: [strAddress]});
                            if(!success) throw new Error('Error while invoking contract');
                            this._receivers[strAddress]=1;
                        }`
            };
            const strContractCallerAddr = generateAddress().toString('hex');
            contract = new factory.Contract({
                contractData: {_receivers: {[generateAddress().toString('hex')]: 1}},
                contractCode: JSON.stringify((objCode))
            }, strContractCallerAddr);
            const objCode2 = {
                "testAnother": `<(strAddress){this._callCount++; send(strAddress, 1e3)}`
            };

            const strContractSenderAddr = generateAddress().toString('hex');
            const contract2 = new factory.Contract({
                contractData: {_callCount: 100},
                contractCode: JSON.stringify((objCode2)),
                balance: 1e10
            }, strContractSenderAddr);

            node._getContractByAddr = sinon.fake.resolves(contract2);
            const patchTx = new factory.PatchDB();
            const strThisTx = pseudoRandomBuffer().toString('hex');

            const txReceipt = await node._app.runContract(
                coinsLimit,
                createObjInvocationCode('test', [strReceiver]),
                contract,
                env,
                undefined,
                node._createCallbacksForApp(new factory.PatchDB(), patchTx, strThisTx)
            );
            assert.isOk(txReceipt instanceof factory.TxReceipt);
            assert.equal(txReceipt.getStatus(), factory.Constants.TX_STATUS_OK);

            patchTx.setReceipt(strThisTx, txReceipt);
            patchTx.setContract(contract);

            const thisTxReceipt = patchTx.getReceipt(strThisTx);

            // moneys sent in contract2 present?
            assert.equal(thisTxReceipt.getInternalTxns().length, 1);

            {
                // new data of contract
                const contractCaller = patchTx.getContract(strContractCallerAddr);
                assert.isOk(contractCaller);
                const {_receivers} = contractCaller.getData();
                assert.equal(Object.keys(_receivers).length, 2);
                assert.isOk(_receivers[strReceiver]);

                // new data of contract2
                const contractSender = patchTx.getContract(strContractSenderAddr);
                assert.isOk(contractSender);
                const {_callCount} = contractSender.getData();
                assert.equal(_callCount, 101);

                // new balance of contract2
                assert.equal(contractSender.getBalance(), 1e10 - 1e3);
            }
        });

        it('should SUCCESSFULLY "delegatecall" nested contract with nested send', async () => {
            const coinsLimit = 3 * factory.Constants.fees.CONTRACT_FEE + factory.Constants.fees.INTERNAL_TX_FEE + 1;

            const strReceiver = generateAddress().toString('hex');
            const objCode = {
                "test": `<(strAddress){
                            const success=await delegatecall(strAddress, {method: "testAnother", arrArguments: [strAddress]});
                            if(!success) throw new Error('Error while invoking contract');
                            this._receivers[strAddress]=1;
                        }`
            };
            const strContractCallerAddr = generateAddress().toString('hex');
            contract = new factory.Contract({
                contractData: {_receivers: {[generateAddress().toString('hex')]: 1}},
                contractCode: JSON.stringify((objCode))
            }, strContractCallerAddr);
            const objCode2 = {
                "testAnother": `<(strAddress){this._receivers['test']=1;}`
            };

            const strContractSenderAddr = generateAddress().toString('hex');
            const contract2 = new factory.Contract({
                contractData: {_callCount: 100},
                contractCode: JSON.stringify((objCode2)),
                balance: 1e10
            }, strContractSenderAddr);

            node._getContractByAddr = sinon.fake.resolves(contract2);
            const patchTx = new factory.PatchDB();
            const strThisTx = pseudoRandomBuffer().toString('hex');

            const txReceipt = await node._app.runContract(
                coinsLimit,
                createObjInvocationCode('test', [strReceiver]),
                contract,
                env,
                undefined,
                node._createCallbacksForApp(new factory.PatchDB(), patchTx, strThisTx)
            );
            assert.isOk(txReceipt instanceof factory.TxReceipt);
            assert.equal(txReceipt.getStatus(), factory.Constants.TX_STATUS_OK);

            patchTx.setReceipt(strThisTx, txReceipt);
            patchTx.setContract(contract);

            {
                // new data of contract
                const contractCaller = patchTx.getContract(strContractCallerAddr);
                assert.isOk(contractCaller);
                const {_receivers} = contractCaller.getData();
                assert.equal(Object.keys(_receivers).length, 3);
                assert.isOk(_receivers[strReceiver]);
                assert.isOk(_receivers['test']);

                // OLD! data of contract2
                const contractSender = patchTx.getContract(strContractSenderAddr);
                assert.isOk(contractSender);
                const {_callCount} = contractSender.getData();
                assert.equal(_callCount, 100);
            }
        });
    });
});
