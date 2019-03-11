'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');

const factory = require('../testFactory');
const {pseudoRandomBuffer, generateAddress} = require('../testUtil');

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
        const tx = factory.Transaction.createContract(contractCode, 1e5, generateAddress());

        await node._processContract(false, undefined, tx, patchTx, nCoinsIn);

        const receipt = patchTx.getReceipt(tx.hash());
        assert.isOk(receipt);
        assert.equal(receipt.getStatus(), factory.Constants.TX_STATUS_FAILED);

        // despite terminated invocation we should send fee to miner and send change to invoker
        assert.isOk(receipt.getCoinsUsed() > 0);
        assert.isNotOk(patchTx.getContract(receipt.getContractAddress()));
        assert.equal(receipt.getInternalTxns().length, 1);
        const [changeTxHash] = receipt.getInternalTxns();
        assert.isOk(changeTxHash);
        const changeUxo = patchTx.getUtxo(changeTxHash);
        assert.isOk(changeUxo);
        assert.equal(changeUxo.amountOut(), nCoinsIn - factory.Constants.MIN_CONTRACT_FEE);

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
        const tx = factory.Transaction.createContract(contractCode, 1e5, generateAddress());

        await node._processContract(false, undefined, tx, patchTx, nCoinsIn);

        const receipt = patchTx.getReceipt(tx.hash());
        assert.isOk(receipt);
        assert.equal(receipt.getStatus(), factory.Constants.TX_STATUS_OK);
        assert.isOk(receipt.getCoinsUsed() > 0);
        const contract = patchTx.getContract(receipt.getContractAddress());
        assert.isOk(contract);
        assert.deepEqual(contract.getData(), {_someData: 42});
        assert.equal(receipt.getInternalTxns().length, 1);
        const [changeTxHash] = receipt.getInternalTxns();
        assert.isOk(changeTxHash);
        const changeUxo = patchTx.getUtxo(changeTxHash);
        assert.isOk(changeUxo);
        assert.equal(changeUxo.amountOut(), nCoinsIn - factory.Constants.MIN_CONTRACT_FEE);

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
        const tx = factory.Transaction.createContract(contractCode, 1e5, generateAddress());
        let contract;

        // deploy contract and check success
        await node._processContract(false, undefined, tx, patchTx, nCoinsIn);

        {
            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.equal(receipt.getStatus(), factory.Constants.TX_STATUS_OK);
            assert.isOk(receipt.getCoinsUsed() > 0);

            contract = patchTx.getContract(receipt.getContractAddress());
            assert.isOk(contract);
        }

        // call for it
        const objCodeToRun = {method: 'someFunction', arrArguments: []};
        const txRun = factory.Transaction.invokeContract(
            contract.getStoredAddress(),
            objCodeToRun,
            0,
            1e5,
            generateAddress()
        );
        const patchRun = new factory.PatchDB();

        await node._processContract(false, contract, txRun, patchRun, nCoinsIn);

        {
            const receipt = patchRun.getReceipt(txRun.hash());
            assert.isOk(receipt);
            assert.equal(receipt.getStatus(), factory.Constants.TX_STATUS_FAILED);

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
            assert.equal(changeUxo.amountOut(), nCoinsIn - factory.Constants.MIN_CONTRACT_FEE);

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
            {method: 'add', arrArguments: [10]},
            100,
            1e5,
            undefined
        );
        const tx2 = factory.Transaction.invokeContract(
            strContractAddr,
            {method: 'add', arrArguments: [100]},
            100,
            1e5,
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

        await node._processTx(true, tx, patch);

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

        const sentToContract = 1e3;
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
        const tx = factory.Transaction.createContract(contractCode, 1e5, generateAddress());
        tx.signForContract(kp.privateKey);

        // deploy contract and check success
        await node._processContract(false, undefined, tx, patchTx, nCoinsIn);

        let contract;
        {
            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.equal(receipt.getStatus(), factory.Constants.TX_STATUS_OK);
            assert.isOk(receipt.getCoinsUsed() > 0);

            contract = patchTx.getContract(receipt.getContractAddress());
            assert.isOk(contract);

            assert.equal(contract.getData()._ownerAddress, kp.address);
            assert.equal(contract.getData()._contractAddr, receipt.getContractAddress());
        }

        // call for it
        const objCodeToRun = {method: 'testVariables', arrArguments: []};
        const txRun = factory.Transaction.invokeContract(
            contract.getStoredAddress(),
            objCodeToRun,
            sentToContract,
            1e5,
            generateAddress()
        );
        txRun.signForContract(kp.privateKey);

        const patchRun = new factory.PatchDB();

        await node._processContract(false, contract, txRun, patchRun, nCoinsIn);
        {
            const receipt = patchRun.getReceipt(txRun.hash());
            assert.isOk(receipt);
            assert.equal(receipt.getStatus(), factory.Constants.TX_STATUS_OK);
            assert.isOk(receipt.getCoinsUsed() > 0);

            assert.isOk(patchRun.getContract(contract.getStoredAddress()));

            // balance had changed
            assert.equal(contract.getBalance(), sentToContract);

            // variable tested
            assert.isOk(contract.getData()._testResult);

            // change transferred as internal TX
            assert.equal(receipt.getInternalTxns().length, 1);
            const [changeTxHash] = receipt.getInternalTxns();
            assert.isOk(changeTxHash);
            const changeUxo = patchRun.getUtxo(changeTxHash);
            assert.isOk(changeUxo);
            assert.equal(changeUxo.amountOut(), nCoinsIn - factory.Constants.MIN_CONTRACT_FEE);

            // no UTXO created for transferred coins
            assert.isNotOk(patchRun.getUtxo(tx.getHash()));

        }
    });
});
