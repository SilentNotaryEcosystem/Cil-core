'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');

const factory = require('../testFactory');
const {pseudoRandomBuffer, generateAddress, createObjInvocationCode} = require('../testUtil');

const createContractInvocationTx = (strContractAddr, code = {}, hasChangeReceiver = true, amount = 0) => {

    // prepare tx (for non genesis block)
    let tx;

    if (hasChangeReceiver) {
        tx = factory.Transaction.invokeContract(strContractAddr, code, amount, generateAddress());
    } else {
        tx = factory.Transaction.invokeContract(strContractAddr, code, amount);
    }
    tx.conciliumId = 0;
    tx.addInput(pseudoRandomBuffer(), 12);

    tx.verify = sinon.fake();

    return tx;
};

describe('Contract integration tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should NOT DEPLOY contract (constructor throws)', async () => {
        const nCoinsIn = factory.Constants.fees.CONTRACT_CREATION_FEE + 1e3;
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
        assert.equal(changeUxo.amountOut(), nCoinsIn - factory.Constants.fees.CONTRACT_CREATION_FEE);

        // no UTXO created for transferred coins
        assert.isNotOk(patchTx.getUtxo(tx.getHash()));
    });

    it('should deploy contract', async () => {
        const nCoinsIn = factory.Constants.fees.CONTRACT_CREATION_FEE + 1e3;
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

        const expectedChange = nCoinsIn -
                               factory.Constants.fees.CONTRACT_CREATION_FEE -
                               contract.getDataSize() * factory.Constants.fees.STORAGE_PER_BYTE_FEE;

        assert.equal(changeUxo.amountOut(), expectedChange);

        // no UTXO created for transferred coins
        assert.isNotOk(patchTx.getUtxo(tx.getHash()));
    });

    it('should TERMINATE contract INVOCATION (throws error)', async () => {
        const nCoinsIn = factory.Constants.fees.CONTRACT_CREATION_FEE + 1e3;
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
            assert.equal(changeUxo.amountOut(), nCoinsIn - factory.Constants.fees.CONTRACT_INVOCATION_FEE);

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

        // tx1 & tx2 created with conciliumId 0
        const block = new factory.Block(0);
        block.addTx(tx1);
        block.addTx(tx2);
        block.finish(0, generateAddress());

        node.isGenesisBlock = () => true;
        node._pendingBlocks.mergePatches = () => new factory.PatchDB();
        node._storage.getContract = () => new factory.Contract({
            conciliumId: 0,
            contractCode: '{"add": "(a){this.value+=a;}"}',
            contractData: {value: 23}
        }, strContractAddr);

        const patchState = await node._execBlock(block);

        assert.isOk(patchState);
        const patchContract = patchState.getContract(strContractAddr);
        assert.isOk(patchContract);
        assert.deepEqual(patchContract.getData(), {value: 133});
    });

//    it('should create block with 2 subsequent calls', async () => {
//        const keyPair1 = factory.Crypto.createKeyPair();
//        const wallet = new factory.Wallet(keyPair1.privateKey);
//        const witness = new factory.Witness({wallet});
//        await witness.ensureLoaded();
//
//        const strContractAddr = generateAddress().toString('hex');
//        const tx1 = factory.Transaction.invokeContract(
//            strContractAddr,
//            createObjInvocationCode('add', [10]),
//            100,
//            undefined
//        );
//        const tx2 = factory.Transaction.invokeContract(
//            strContractAddr,
//            createObjInvocationCode('add', [100]),
//            100,
//            undefined
//        );
//
//        witness._pendingBlocks.getBestParents =sinon.fake.resolves({arrParents: pseudoRandomBuffer()});
//        witness._calcHeight =sinon.fake.returns(10);
//        witness._mempool.getFinalTxns=sinon.fake.returns([tx1, tx2]);
//        witness._processTx=sinon.fake((n1,n2,tx) =>{
//
//        });
//
//    });

    it('should INVOKE CONTRACT with EMPTY CODE when transferring moneys to contract', async () => {
        const buffContractAddr = generateAddress();

        const node = new factory.Node();
        await node.ensureLoaded();
        node._app.runContract = sinon.fake.returns(new factory.TxReceipt({status: factory.Constants.TX_STATUS_OK}));

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

        // tx1 & tx2 created with conciliumId 0
        const block = new factory.Block(0);
        block.addTx(tx1);
        block.addTx(tx2);
        block.finish(0, generateAddress());

        node.isGenesisBlock = () => true;
        node._pendingBlocks.mergePatches = () => new factory.PatchDB();
        node._storage.getContract = () => new factory.Contract({
            conciliumId: 0,
            contractCode: '{"_default": "(){}"}'
        }, strContractAddr);

        const patchState = await node._execBlock(block);

        assert.isOk(patchState);
        const contractPatch = patchState.getContract(strContractAddr);
        assert.isOk(contractPatch);
        assert.equal(contractPatch.getBalance(), 4000);
    });

    it('should DEPLOY & INVOKE contract & test GLOBAL VARIABLES', async () => {
        const nCoinsIn = factory.Constants.fees.CONTRACT_CREATION_FEE +
                         factory.Constants.fees.CONTRACT_INVOCATION_FEE +
                         1e5;
        const node = new factory.Node();
        const patchTx = new factory.PatchDB();

        const nCoinsSentToContract = 1e3;
        const kp = factory.Crypto.createKeyPair();

        const contractCode = `
            class TestContract extends Base{
                constructor(answer) {
                    super();
                    this._contractAddr = contractAddr;
                    this._someData=answer;
                }
                
                testVariables(blockHash, blockHeight, blockTimestamp) {
                    this._testResult= this._ownerAddress === callerAddress && 
                        this._contractAddr === contractAddr &&
                        value === ${nCoinsSentToContract} &&
                        block.hash &&
                        block.height === blockHeight,
                        block.timestamp===blockTimestamp;
                }
            };

            exports=new TestContract(42);
            `;
        const tx = factory.Transaction.createContract(contractCode, generateAddress());
        tx.signForContract(kp.privateKey);

        const fakeBlock = {
            getHeight: () => 11,
            timestamp: Date.now(),
            getHash: () => pseudoRandomBuffer().toString('hex')
        };
        node._processedBlock = fakeBlock;
        const nFeeSizeCreateTx = await node._calculateSizeFee(tx);

        // deploy contract and check success
        await node._processContract(false, undefined, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFeeSizeCreateTx);

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

            // change transferred as internal TX
            assert.equal(receipt.getInternalTxns().length, 1);
            const [changeTxHash] = receipt.getInternalTxns();
            assert.isOk(changeTxHash);
            const changeUxo = patchTx.getUtxo(changeTxHash);
            assert.isOk(changeUxo);
            const expectedChange = nCoinsIn -
                                   factory.Constants.fees.CONTRACT_CREATION_FEE -
                                   contract.getDataSize() * factory.Constants.fees.STORAGE_PER_BYTE_FEE -
                                   nFeeSizeCreateTx;

            assert.equal(changeUxo.amountOut(), expectedChange);
        }

        const contractDataSize = contract.getDataSize();

        // call for it
        const objCodeToRun = createObjInvocationCode(
            'testVariables',
            [fakeBlock.getHash(), fakeBlock.getHeight(), fakeBlock.timestamp]
        );
        const txRun = factory.Transaction.invokeContract(
            contract.getStoredAddress(),
            objCodeToRun,
            nCoinsSentToContract,
            generateAddress()
        );
        txRun.signForContract(kp.privateKey);

        const patchRun = new factory.PatchDB();
        node._processedBlock = fakeBlock;
        const nFeeSizeTx = await node._calculateSizeFee(txRun);

        await node._processContract(false, contract, txRun, patchRun, new factory.PatchDB(), nCoinsIn, nFeeSizeTx);

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
                                   factory.Constants.fees.CONTRACT_INVOCATION_FEE -
                                   nFeeSizeTx -
                                   (contract.getDataSize() - contractDataSize) *
                                   factory.Constants.fees.STORAGE_PER_BYTE_FEE;

            assert.equal(changeUxo.amountOut(), expectedChange);

            // no UTXO created for transferred coins
            assert.isNotOk(patchRun.getUtxo(tx.getHash()));

        }
    });

    describe('Send moneys TO contract', () => {
        let node;
        let contract;
        const contractBalance = 0;
        const nCoinsToSend = 1e4;
        let tx;
        let strContractAddr;

        const nFakeFeeTx = 4e3;
        let coinsLimit;

        beforeEach(async () => {
            node = new factory.Node();
            await node.ensureLoaded();

            strContractAddr = generateAddress().toString('hex');

            contract = new factory.Contract({
                balance: contractBalance,
                contractCode: `{"test": "(){}", "throws": "(){throw 'error'}"}`
            }, strContractAddr);

            node._calculateSizeFee = sinon.fake.resolves(nFakeFeeTx);
            coinsLimit = factory.Constants.fees.CONTRACT_INVOCATION_FEE + factory.Constants.fees.INTERNAL_TX_FEE +
                         nFakeFeeTx;
        });

        it('should fail to send (function throws)', async () => {
            tx = createContractInvocationTx(
                strContractAddr,
                createObjInvocationCode('throws', []),
                false,
                nCoinsToSend
            );

            const patchTx = new factory.PatchDB();
            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), coinsLimit);

            const receipt = patchTx.getReceipt(tx.getHash());
            assert.isNotOk(receipt.isSuccessful());

            assert.equal(contract.getBalance(), contractBalance);
        });

        it('should send', async () => {
            tx = createContractInvocationTx(
                strContractAddr,
                createObjInvocationCode('test', []),
                false,
                nCoinsToSend
            );

            const patchTx = new factory.PatchDB();
            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), coinsLimit);

            const receipt = patchTx.getReceipt(tx.getHash());
            assert.isOk(receipt.isSuccessful());

            assert.equal(contract.getBalance(), nCoinsToSend);
        });

    });

    describe('Send moneys TO NESTED contract', () => {
        let node;
        let contract;
        const contractBalance = 0;
        const nCoinsToSend = 1e4;
        let tx;
        let strContractAddr;

        const nFakeFeeTx = 4e3;
        let coinsLimit;

        beforeEach(async () => {
            node = new factory.Node();
            await node.ensureLoaded();

            strContractAddr = generateAddress().toString('hex');
            const strNestedContractAddr = generateAddress().toString('hex');

            contract = new factory.Contract({
                balance: contractBalance,
                contractCode: `{
                    "test": "(){delegatecall('${strNestedContractAddr}', {method: 'test', arrArguments: []})}",
                    "throws": "(){delegatecall('${strNestedContractAddr}', {method: 'throws', arrArguments: []})}"
                }`
            }, strContractAddr);

            const contract2 = new factory.Contract({
                balance: contractBalance,
                contractCode: `{"test": "(){}", "throws": "(){throw 'error'}"}`
            }, strContractAddr);

            node._calculateSizeFee = sinon.fake.resolves(nFakeFeeTx);
            node._getContractByAddr = sinon.fake.resolves(contract2);

            coinsLimit = 2 * factory.Constants.fees.CONTRACT_INVOCATION_FEE + nFakeFeeTx;
        });

        it('should fail to send (function throws)', async () => {
            tx = createContractInvocationTx(
                strContractAddr,
                createObjInvocationCode('throws', []),
                false,
                nCoinsToSend
            );

            const patchTx = new factory.PatchDB();
            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), coinsLimit);

            const receipt = patchTx.getReceipt(tx.getHash());
            assert.isNotOk(receipt.isSuccessful());

            assert.equal(contract.getBalance(), contractBalance);
        });

        it('should send', async () => {
            tx = createContractInvocationTx(
                strContractAddr,
                createObjInvocationCode('test', []),
                false,
                nCoinsToSend
            );

            const patchTx = new factory.PatchDB();
            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), coinsLimit);

            const receipt = patchTx.getReceipt(tx.getHash());
            assert.isOk(receipt.isSuccessful());

            assert.equal(contract.getBalance(), nCoinsToSend);
        });

    });

    describe('Send moneys FROM contract', () => {
        let node;
        let contract;
        const contractBalance = 1e4;
        const strAddress = generateAddress().toString('hex');
        let env;
        const nFakeFeeTx = 4e3;
        let coinsLimit;

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

            coinsLimit = factory.Constants.fees.CONTRACT_INVOCATION_FEE + factory.Constants.fees.INTERNAL_TX_FEE +
                         nFakeFeeTx;
        });

        it('should FAIL (not enough coins)', async () => {
            const txReceipt = await node._app.runContract(
                coinsLimit,
                createObjInvocationCode('test', [strAddress, contractBalance + 1]),
                contract,
                env,
                undefined,
                node._createCallbacksForApp(),
                {
                    nFeeContractInvocation: factory.Constants.fees.CONTRACT_INVOCATION_FEE,
                    nFeeSize: nFakeFeeTx,
                    nFeeStorage: factory.Constants.fees.STORAGE_PER_BYTE_FEE
                }
            );
            assert.isOk(txReceipt instanceof factory.TxReceipt);
            assert.isNotOk(txReceipt.isSuccessful());
            assert.equal(txReceipt.getMessage(), 'Not enough funds for "send"');
        });

        it('should FAIL (not enough coins to perform send)', async () => {
            coinsLimit = factory.Constants.fees.CONTRACT_INVOCATION_FEE;
            const txReceipt = await node._app.runContract(
                coinsLimit - 1,
                createObjInvocationCode('test', [strAddress, contractBalance]),
                contract,
                env,
                undefined,
                node._createCallbacksForApp(),
                {
                    nFeeContractInvocation: factory.Constants.fees.CONTRACT_INVOCATION_FEE,
                    nFeeSize: nFakeFeeTx,
                    nFeeStorage: factory.Constants.fees.STORAGE_PER_BYTE_FEE
                }
            );
            assert.isOk(txReceipt instanceof factory.TxReceipt);
            assert.isNotOk(txReceipt.isSuccessful());
            assert.equal(txReceipt.getMessage(), 'Contract run out of coins');
        });

        it('should Success (send all moneys)', async () => {
            const coinsLimit = factory.Constants.fees.CONTRACT_INVOCATION_FEE + factory.Constants.fees.INTERNAL_TX_FEE +
                               nFakeFeeTx;
            const strThisTxHash = pseudoRandomBuffer().toString('hex');
            const patchTx = new factory.PatchDB();
            const txReceipt = await node._app.runContract(
                coinsLimit,
                createObjInvocationCode('test', [strAddress, contractBalance]),
                contract,
                env,
                undefined,
                node._createCallbacksForApp(undefined, undefined, patchTx, strThisTxHash),
                {
                    nFeeContractInvocation: factory.Constants.fees.CONTRACT_INVOCATION_FEE,
                    nFeeSize: nFakeFeeTx,
                    nFeeStorage: factory.Constants.fees.STORAGE_PER_BYTE_FEE
                }
            );

            assert.isOk(txReceipt instanceof factory.TxReceipt);
            assert.isOk(txReceipt.isSuccessful());

            const receipt = patchTx.getReceipt(strThisTxHash);

            const arrInternalTxns = [...receipt.getInternalTxns()];
            assert.equal(arrInternalTxns.length, 1);

            assert.equal(contract.getBalance(), 0);
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
            const coinsLimit = factory.Constants.fees.CONTRACT_INVOCATION_FEE;
            const txReceipt = await node._app.runContract(
                coinsLimit - 1,
                createObjInvocationCode('test', [strAddress, 'test', 1, 2, 3, 4]),
                contract,
                env,
                undefined,
                node._createCallbacksForApp(),
                {
                    nFeeContractInvocation: factory.Constants.fees.CONTRACT_INVOCATION_FEE,
                    nFeeSize: 4e3,
                    nFeeStorage: factory.Constants.fees.STORAGE_PER_BYTE_FEE
                }
            );
            assert.isOk(txReceipt instanceof factory.TxReceipt);
            assert.isNotOk(txReceipt.isSuccessful());
            assert.equal(txReceipt.getMessage(), 'Contract run out of coins');
        });

        it('should FAIL to call (trying to pass more coins than have)', async () => {
            const coinsLimit = 2 * factory.Constants.fees.CONTRACT_INVOCATION_FEE;

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
                node._createCallbacksForApp(),
                {
                    nFeeContractInvocation: factory.Constants.fees.CONTRACT_INVOCATION_FEE,
                    nFeeSize: 4e3,
                    nFeeStorage: factory.Constants.fees.STORAGE_PER_BYTE_FEE
                }
            );
            assert.isOk(txReceipt instanceof factory.TxReceipt);
            assert.isNotOk(txReceipt.isSuccessful());
            assert.equal(txReceipt.getMessage(), 'Trying to pass more coins than have');
        });

        it('should FAIL to call (trying to pass negative coinsLimit)', async () => {
            const coinsLimit = 2 * factory.Constants.fees.CONTRACT_INVOCATION_FEE;

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
                node._createCallbacksForApp(),
                {
                    nFeeContractInvocation: factory.Constants.fees.CONTRACT_INVOCATION_FEE,
                    nFeeSize: 4e3,
                    nFeeStorage: factory.Constants.fees.STORAGE_PER_BYTE_FEE
                }
            );
            assert.isOk(txReceipt instanceof factory.TxReceipt);
            assert.isNotOk(txReceipt.isSuccessful());
            assert.equal(txReceipt.getMessage(), 'coinsLimit should be positive');
        });

        it('should SUCCESSFULLY "call" nested contract with nested send', async () => {
            const nAmountToSend = 1e3;
            const coinsLimit = 2 * factory.Constants.fees.CONTRACT_INVOCATION_FEE +
                               2 * factory.Constants.fees.INTERNAL_TX_FEE +
                               factory.Constants.fees.TX_FEE +
                               nAmountToSend;

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
                "testAnother": `<(strAddress){this._someSecondContractVal++; send(strAddress, ${nAmountToSend})}`
            };

            const strContractSenderAddr = generateAddress().toString('hex');
            const contract2 = new factory.Contract({
                contractData: {_someSecondContractVal: 100},
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
                node._createCallbacksForApp(contract, new factory.PatchDB(), patchTx, strThisTx),
                {
                    nFeeContractInvocation: factory.Constants.fees.CONTRACT_INVOCATION_FEE,
                    nFeeSize: 4e3,
                    nFeeStorage: factory.Constants.fees.STORAGE_PER_BYTE_FEE
                }
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
                const {_someSecondContractVal} = contractSender.getData();
                assert.equal(_someSecondContractVal, 101);

                // new balance of contract2
                assert.equal(contractSender.getBalance(), 1e10 - 1e3);
            }
        });

        it('should SUCCESSFULLY "delegatecall" nested contract', async () => {
            const nBalanceCaller = 1e4;
            const nBalanceSender = 1e10;
            const nAmountToSend = 100;
            const coinsLimit = 3 * factory.Constants.fees.CONTRACT_INVOCATION_FEE +
                               factory.Constants.fees.INTERNAL_TX_FEE +
                               factory.Constants.fees.TX_FEE;

            // first contract will call second contract and set internal _receivers with argument address
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
                contractCode: JSON.stringify((objCode)),
                balance: nBalanceCaller
            }, strContractCallerAddr);

            // second contract will set internal _receivers with argument 'test'
            const objCode2 = {
                "testAnother": `<(strAddress){
                    this._receivers['test']=1; 
                    send(strAddress, ${nAmountToSend});
                }`
            };
            const strContractSenderAddr = generateAddress().toString('hex');
            const contract2 = new factory.Contract({
                contractData: {_someSecondContractVal: 100},
                contractCode: JSON.stringify((objCode2)),
                balance: nBalanceSender
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
                node._createCallbacksForApp(contract, new factory.PatchDB(), patchTx, strThisTx),
                {
                    nFeeContractInvocation: factory.Constants.fees.CONTRACT_INVOCATION_FEE,
                    nFeeSize: 4e3,
                    nFeeStorage: factory.Constants.fees.STORAGE_PER_BYTE_FEE
                }
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

                // balance of original contract was changed
                assert.equal(contractCaller.getBalance(), nBalanceCaller - nAmountToSend);

                // OLD! data of contract2
                const contractSender = patchTx.getContract(strContractSenderAddr);
                assert.isOk(contractSender);

                const {_someSecondContractVal, _receivers: secondReceivers} = contractSender.getData();
                assert.equal(_someSecondContractVal, 100);
                assert.notOk(secondReceivers);
            }
        });
    });
});
