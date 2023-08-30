'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
const sinon = require('sinon').createSandbox();
chai.use(require('chai-as-promised'));
const {assert} = chai;

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
    let node;
    let nCoinsIn;
    const nFakeFeeTx = 1e3;
    const nFakeFeeDataSize = 10;

    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    beforeEach(async () => {
        nCoinsIn = factory.Constants.fees.CONTRACT_CREATION_FEE + nFakeFeeTx + nFakeFeeDataSize * 1000;
        node = new factory.Node();
        node._calculateSizeFee = sinon.fake.resolves(nFakeFeeTx);
        node._getFeeStorage = sinon.fake.resolves(nFakeFeeDataSize);

        await node.ensureLoaded();
    });

    after(async function() {
        this.timeout(15000);
    });

    describe('Contract deploy', async () => {
        it('should NOT DEPLOY contract (constructor throws)', async () => {
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

            await node._processContract(false, undefined, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.isNotOk(receipt.isSuccessful());

            // despite terminated invocation we should send fee to miner and send change to invoker
            const nCoinsShouldBeUsed = factory.Constants.fees.CONTRACT_CREATION_FEE + nFakeFeeTx;
            assert.equal(receipt.getCoinsUsed(), nCoinsShouldBeUsed);

            assert.isNotOk(patchTx.getContract(receipt.getContractAddress()));

            assert.equal(receipt.getInternalTxns().length, 1);
            const [changeTxHash] = receipt.getInternalTxns();
            assert.isOk(changeTxHash);
            const changeUxo = patchTx.getUtxo(changeTxHash);
            assert.isOk(changeUxo);
            assert.equal(changeUxo.amountOut(), nCoinsIn - nCoinsShouldBeUsed);

            // no UTXO created for transferred coins
            assert.isNotOk(patchTx.getUtxo(tx.getHash()));
        });

        it('should deploy contract (before first fork)', async () => {

            // data serialized to V8
            node._processedBlock = {
                getHeight: () => factory.Constants.forks.HEIGHT_FORK_SERIALIZER - 1,
                getHash: () => pseudoRandomBuffer().toString('hex'),
                timestamp: parseInt(Date.now() / 1000)
            };
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

            await node._processContract(false, undefined, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());

            const contract = patchTx.getContract(receipt.getContractAddress());
            assert.isOk(contract);

            const nCoinsShouldBeUsed = factory.Constants.fees.CONTRACT_CREATION_FEE +
                                       nFakeFeeTx +
                                       contract.getDataSize() * nFakeFeeDataSize;
            assert.equal(receipt.getCoinsUsed(), nCoinsShouldBeUsed);

            // legacy code count like this!
            assert.equal(receipt.getCoinsUsed(), 1001130);

            assert.deepEqual(contract.getData(), {_someData: 42});
            assert.equal(receipt.getInternalTxns().length, 1);
            const [changeTxHash] = receipt.getInternalTxns();
            assert.isOk(changeTxHash);
            const changeUxo = patchTx.getUtxo(changeTxHash);
            assert.isOk(changeUxo);

            const expectedChange = nCoinsIn - nCoinsShouldBeUsed;
            assert.equal(changeUxo.amountOut(), expectedChange);

            // no UTXO created for transferred coins
            assert.isNotOk(patchTx.getUtxo(tx.getHash()));
        });

        it('should deploy contract (after first fork and before second)', async () => {

            // data serialized to V8
            // stored as V8
            node._processedBlock = {
                getHeight: () => factory.Constants.forks.HEIGHT_FORK_SERIALIZER + 1,
                getHash: () => pseudoRandomBuffer().toString('hex'),
                timestamp: parseInt(Date.now() / 1000)
            };
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

            await node._processContract(false, undefined, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());

            // legacy code count like this!
            assert.equal(receipt.getCoinsUsed(), 1001130);

            const contract = patchTx.getContract(receipt.getContractAddress());
            assert.isOk(contract);

            const nCoinsShouldBeUsed = factory.Constants.fees.CONTRACT_CREATION_FEE +
                                       nFakeFeeTx +
                                       contract.getDataSize() * nFakeFeeDataSize;
            assert.equal(receipt.getCoinsUsed(), nCoinsShouldBeUsed);
        });

        it('should deploy contract (after second fork)', async () => {

            // same as before
            node._processedBlock = {
                getHeight: () => factory.Constants.forks.HEIGHT_FORK_SERIALIZER_FIX2 + 1,
                getHash: () => pseudoRandomBuffer().toString('hex'),
                timestamp: parseInt(Date.now() / 1000)
            };

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

            await node._processContract(false, undefined, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());

            // legacy code count like this!
            assert.equal(receipt.getCoinsUsed(), 1001130);

            const contract = patchTx.getContract(receipt.getContractAddress());
            assert.isOk(contract);

            const nCoinsShouldBeUsed = factory.Constants.fees.CONTRACT_CREATION_FEE +
                                       nFakeFeeTx +
                                       contract.getDataSize() * nFakeFeeDataSize;
            assert.equal(receipt.getCoinsUsed(), nCoinsShouldBeUsed);
        });

        it('should deploy contract (after 3d fork)', async () => {

            // same as before
            node._processedBlock = {
                getHeight: () => factory.Constants.forks.HEIGHT_FORK_SERIALIZER_FIX3 + 1,
                getHash: () => pseudoRandomBuffer().toString('hex'),
                timestamp: parseInt(Date.now() / 1000)
            };

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

            await node._processContract(false, undefined, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());

            const contract = patchTx.getContract(receipt.getContractAddress());
            assert.isOk(contract);

            const nCoinsShouldBeUsed = factory.Constants.fees.CONTRACT_CREATION_FEE +
                                       nFakeFeeTx +
                                       contract.getDataSize() * nFakeFeeDataSize;
            assert.equal(receipt.getCoinsUsed(), nCoinsShouldBeUsed);
        });
    });

    describe('Contract invoke', async () => {
        let contract;
        let tx;
        let strContractAddress;
        let objBeforeExec;
        let objAfterExec;

        const fakeWorkAround = (contract) => {
            const origFn = contract.dirtyWorkaround;
            sinon.stub(contract, 'dirtyWorkaround').callsFake(() => {
                origFn.call(contract);
            });
        };

        const fakeApp = (node) => {
            const origFnExecStarted = node._app._execStarted;
            sinon.stub(node._app, '_execStarted').callsFake((contract) => {
                objBeforeExec = {
                    dataSize: contract.getDataSize(),
                    version: contract.getVersion()
                };
                origFnExecStarted.call(node._app, contract);
            });

            const origFnExecDone = node._app._execDone;
            sinon.stub(node._app, '_execDone').callsFake((contract) => {
                objAfterExec = {
                    dataSize: contract.getDataSize(),
                    version: contract.getVersion()
                };
                origFnExecDone.call(node._app, contract);
            });
        };

        beforeEach(async () => {
            strContractAddress = generateAddress().toString('hex');

            contract = new factory.Contract({
                contractData: {
                    v: 1,
                    arrData: [1, 2, 3, 4],
                    objData: {v: 2}
                },
                contractCode: '{"test": "<(){this.arrData.push(100)}", "testInjected": "(msg){this.hash=sha3(msg);}"}',
                conciliumId: 0
            }, strContractAddress, factory.Constants.CONTRACT_V_V8);

            fakeWorkAround(contract);
            fakeApp(node);

            node._getContractByAddr = async () => contract;

            tx = factory.Transaction.invokeContract(
                generateAddress().toString('hex'),
                createObjInvocationCode('test', []),
                1e5
            );
        });

        afterEach(async () => {
            sinon.restore();
        });

        it('should invoke contract (before first fork)', async () => {
            const patchTx = new factory.PatchDB();
            node._processedBlock = {
                getHeight: () => factory.Constants.forks.HEIGHT_FORK_SERIALIZER - 1,
                getHash: () => pseudoRandomBuffer().toString('hex'),
                timestamp: parseInt(Date.now() / 1000)
            };

            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());

            // legacy code count like this!
            assert.equal(receipt.getCoinsUsed(), 11030);

            contract = patchTx.getContract(strContractAddress);
            assert.isOk(contract);

            assert.isOk(contract.dirtyWorkaround.calledOnce);

            assert.equal(objBeforeExec.version, factory.Constants.CONTRACT_V_V8);
            assert.equal(objAfterExec.version, factory.Constants.CONTRACT_V_V8);
        });

        it('should invoke contract (between first and 2nd fork)', async () => {
            const patchTx = new factory.PatchDB();
            node._processedBlock = {
                getHeight: () => factory.Constants.forks.HEIGHT_FORK_SERIALIZER + 1,
                getHash: () => pseudoRandomBuffer().toString('hex'),
                timestamp: parseInt(Date.now() / 1000)
            };

            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());

            // legacy code count like this!
            assert.equal(receipt.getCoinsUsed(), 11040);

            contract = patchTx.getContract(strContractAddress);
            assert.isOk(contract);

            assert.isOk(contract.dirtyWorkaround.calledOnce);

            assert.equal(objBeforeExec.version, factory.Constants.CONTRACT_V_JSON);
            assert.equal(objAfterExec.version, factory.Constants.CONTRACT_V_JSON);

//            assert.equal(objBeforeExec.dataSize, factory.Constants.);
        });

        it('should invoke contract (after 2nd fork)', async () => {
            const patchTx = new factory.PatchDB();
            node._processedBlock = {
                getHeight: () => factory.Constants.forks.HEIGHT_FORK_SERIALIZER_FIX2 + 1,
                getHash: () => pseudoRandomBuffer().toString('hex'),
                timestamp: parseInt(Date.now() / 1000)
            };

            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());

            // legacy code count like this!
            assert.equal(receipt.getCoinsUsed(), 11040);

            contract = patchTx.getContract(strContractAddress);
            assert.isOk(contract);

            assert.isOk(contract.dirtyWorkaround.calledOnce);

            assert.equal(objBeforeExec.version, factory.Constants.CONTRACT_V_JSON);
            assert.equal(objAfterExec.version, factory.Constants.CONTRACT_V_JSON);
        });

        it('should invoke contract (after 3d fork)', async () => {
            const patchTx = new factory.PatchDB();
            node._processedBlock = {
                getHeight: () => factory.Constants.forks.HEIGHT_FORK_SERIALIZER_FIX3 + 1,
                getHash: () => pseudoRandomBuffer().toString('hex'),
                timestamp: parseInt(Date.now() / 1000)
            };

            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());

            contract = patchTx.getContract(strContractAddress);
            assert.isOk(contract);

            assert.isNotOk(contract.dirtyWorkaround.calledOnce);

            assert.equal(objBeforeExec.version, factory.Constants.CONTRACT_V_JSON);
            assert.equal(objAfterExec.version, factory.Constants.CONTRACT_V_JSON);
        });

        it('should invoke injected function', async () => {
            const patchTx = new factory.PatchDB();
            node._processedBlock = {
                getHeight: () => factory.Constants.forks.HEIGHT_FORK_SERIALIZER - 1,
                getHash: () => pseudoRandomBuffer().toString('hex'),
                timestamp: parseInt(Date.now() / 1000)
            };

            const msg='test';
            tx = factory.Transaction.invokeContract(
                generateAddress().toString('hex'),
                createObjInvocationCode('testInjected', [msg]),
                1e5
            );

            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());
            assert.isOk(contract.getData().hash);
            assert.equal(contract.getData().hash, factory.Crypto.sha3(msg));
        });
    });

    describe('Nested contract invoke', async () => {
        let contract;
        let contractNested;
        let tx;
        let strContractAddress;
        let strContractAddressNested;
        let arrBeforeExec;
        let arrAfterExec;

        const fakeWorkAround = (contract) => {
            const origFn = contract.dirtyWorkaround;
            sinon.stub(contract, 'dirtyWorkaround').callsFake(() => {
                origFn.call(contract);
            });
        };

        const fakeApp = (node) => {
            const origFnExecStarted = node._app._execStarted;
            sinon.stub(node._app, '_execStarted').callsFake((contract) => {
                arrBeforeExec.push({
                    dataSize: contract.getDataSize(),
                    version: contract.getVersion()
                });
                origFnExecStarted.call(node._app, contract);
            });

            const origFnExecDone = node._app._execDone;
            sinon.stub(node._app, '_execDone').callsFake((contract) => {
                arrAfterExec.push({
                    dataSize: contract.getDataSize(),
                    version: contract.getVersion()
                });
                origFnExecDone.call(node._app, contract);
            });
        };

        beforeEach(async () => {
            strContractAddress = generateAddress().toString('hex');
            strContractAddressNested = generateAddress().toString('hex');

            arrBeforeExec = [];
            arrAfterExec = [];

            contract = new factory.Contract({
                contractData: {
                    v: 1,
                    arrData: [1, 2, 3, 4],
                    objData: {v: 2}
                },
                contractCode: `{"test": "<(){this.arrData.push(100); await call('${strContractAddressNested}', {method: 'nested', arrArguments:[]});}"}`,
                conciliumId: 0
            }, strContractAddress, factory.Constants.CONTRACT_V_V8);

            contractNested = new factory.Contract({
                contractData: {
                    v: 2,
                    arrDataNested: [100]
                },
                contractCode: '{"nested": "<(){this.arrDataNested.push(200)}"}',
                conciliumId: 0
            }, strContractAddress, factory.Constants.CONTRACT_V_V8);

            fakeWorkAround(contract);
            fakeWorkAround(contractNested);
            fakeApp(node);

            node._getContractByAddr = async (strAddr) => strAddr === strContractAddress ?
                contract : contractNested;

            tx = factory.Transaction.invokeContract(
                generateAddress().toString('hex'),
                createObjInvocationCode('test', []),
                1e5
            );
        });

        afterEach(async () => {
            sinon.restore();
        });

        it('should invoke contract (before first fork)', async () => {
            const patchTx = new factory.PatchDB();
            node._processedBlock = {
                getHeight: () => factory.Constants.forks.HEIGHT_FORK_SERIALIZER - 1,
                getHash: () => pseudoRandomBuffer().toString('hex'),
                timestamp: parseInt(Date.now() / 1000)
            };

            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());

            // legacy code count like this!
            assert.equal(receipt.getCoinsUsed(), 21060);

            contract = patchTx.getContract(strContractAddress);
            assert.isOk(contract);
            assert.isOk(contract.dirtyWorkaround.calledOnce);

            assert.equal(arrBeforeExec[0].version, factory.Constants.CONTRACT_V_V8);
            assert.equal(arrBeforeExec[1].version, factory.Constants.CONTRACT_V_V8);
            assert.equal(arrAfterExec[0].version, factory.Constants.CONTRACT_V_V8);
            assert.equal(arrAfterExec[1].version, factory.Constants.CONTRACT_V_V8);
        });

        it('should invoke contract (between first and 2nd fork)', async () => {
            const patchTx = new factory.PatchDB();
            node._processedBlock = {
                getHeight: () => factory.Constants.forks.HEIGHT_FORK_SERIALIZER + 1,
                getHash: () => pseudoRandomBuffer().toString('hex'),
                timestamp: parseInt(Date.now() / 1000)
            };

            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());

            // legacy code count like this!
            assert.equal(receipt.getCoinsUsed(), 21070);

            contract = patchTx.getContract(strContractAddress);
            assert.isOk(contract);

            assert.isOk(contract.dirtyWorkaround.calledOnce);

            assert.equal(arrBeforeExec[0].version, factory.Constants.CONTRACT_V_JSON);
            assert.equal(arrBeforeExec[1].version, factory.Constants.CONTRACT_V_V8);
            assert.equal(arrAfterExec[0].version, factory.Constants.CONTRACT_V_V8);
            assert.equal(arrAfterExec[1].version, factory.Constants.CONTRACT_V_JSON);
        });

        it('should invoke contract (after 2nd fork)', async () => {
            const patchTx = new factory.PatchDB();
            node._processedBlock = {
                getHeight: () => factory.Constants.forks.HEIGHT_FORK_SERIALIZER_FIX2 + 1,
                getHash: () => pseudoRandomBuffer().toString('hex'),
                timestamp: parseInt(Date.now() / 1000)
            };

            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());

            // legacy code count like this!
            assert.equal(receipt.getCoinsUsed(), 21080);

            contract = patchTx.getContract(strContractAddress);
            assert.isOk(contract);

            assert.isOk(contract.dirtyWorkaround.calledOnce);

            assert.equal(arrBeforeExec[0].version, factory.Constants.CONTRACT_V_JSON);
            assert.equal(arrBeforeExec[1].version, factory.Constants.CONTRACT_V_JSON);
            assert.equal(arrAfterExec[0].version, factory.Constants.CONTRACT_V_JSON);
            assert.equal(arrAfterExec[1].version, factory.Constants.CONTRACT_V_JSON);
        });

        it('should invoke contract (after 3d fork)', async () => {
            const patchTx = new factory.PatchDB();
            node._processedBlock = {
                getHeight: () => factory.Constants.forks.HEIGHT_FORK_SERIALIZER_FIX3 + 1,
                getHash: () => pseudoRandomBuffer().toString('hex'),
                timestamp: parseInt(Date.now() / 1000)
            };

            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

            const receipt = patchTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());

            contract = patchTx.getContract(strContractAddress);
            assert.isOk(contract);

            assert.isNotOk(contract.dirtyWorkaround.calledOnce);

            assert.equal(arrBeforeExec[0].version, factory.Constants.CONTRACT_V_JSON);
            assert.equal(arrBeforeExec[1].version, factory.Constants.CONTRACT_V_JSON);
            assert.equal(arrAfterExec[0].version, factory.Constants.CONTRACT_V_JSON);
            assert.equal(arrAfterExec[1].version, factory.Constants.CONTRACT_V_JSON);
        });

    });

    it('should TERMINATE contract INVOCATION (throws error)', async () => {
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
        await node._processContract(false, undefined, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

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

        await node._processContract(false, contract, txRun, patchRun, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

        {
            const receipt = patchRun.getReceipt(txRun.hash());
            assert.isOk(receipt);
            assert.isNotOk(receipt.isSuccessful());

            // despite terminated invocation we should send fee to miner and send change to invoker

            const nCoinsShouldBeUsed = factory.Constants.fees.CONTRACT_INVOCATION_FEE +
                                       nFakeFeeTx;
            assert.equal(receipt.getCoinsUsed(), nCoinsShouldBeUsed);

            assert.isNotOk(patchRun.getContract(receipt.getContractAddress()));

            // balance of contract is unchanged
            assert.equal(contract.getBalance(), 0);

            assert.equal(receipt.getInternalTxns().length, 1);
            const [changeTxHash] = receipt.getInternalTxns();
            assert.isOk(changeTxHash);
            const changeUxo = patchRun.getUtxo(changeTxHash);
            assert.isOk(changeUxo);
            assert.equal(changeUxo.amountOut(), nCoinsIn - nCoinsShouldBeUsed);

            // no UTXO created for transferred coins
            assert.isNotOk(patchRun.getUtxo(tx.getHash()));
        }
    });

    it('should INVOKE CONTRACT with EMPTY CODE when transferring moneys to contract', async () => {
        const buffContractAddr = generateAddress();

        node._app.runContract = sinon.fake.returns(new factory.TxReceipt({status: factory.Constants.TX_STATUS_OK}));

        const patch = new factory.PatchDB();
        patch.getContract = () => new factory.Contract({conciliumId: 0}, buffContractAddr.toString('hex'));

        const tx = new factory.Transaction();
        tx.addReceiver(1000, buffContractAddr);

        await node._processTx(patch, true, tx);

        assert.isOk(node._app.runContract.calledOnce);
        const [invocationCode] = node._app.runContract.args[0];
        assert.deepEqual(invocationCode, {});
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

    it('should process block with subsequent contract invocation (via default function)', async () => {
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
        await node._processContract(false, undefined, tx, patchTx, new factory.PatchDB(), nCoinsIn,
            nFeeSizeCreateTx
        );

        let contract;
        const receipt = patchTx.getReceipt(tx.hash());
        contract = patchTx.getContract(receipt.getContractAddress());
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

        await node._processContract(false, contract, txRun, patchRun, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

        {
            const receipt = patchRun.getReceipt(txRun.hash());
            assert.isOk(receipt);
            assert.isOk(receipt.isSuccessful());

            const nCoinsShouldBeUsed = factory.Constants.fees.CONTRACT_INVOCATION_FEE +
                                       nFakeFeeTx +
                                       (contract.getDataSize() - contractDataSize) * nFakeFeeDataSize;
            assert.equal(receipt.getCoinsUsed(), nCoinsShouldBeUsed);

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
            const expectedChange = nCoinsIn - nCoinsShouldBeUsed;

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
                contractCode: `{"test": "(){}", "throws": "(){throw 'error'}"}`,
                conciliumId: 0
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
            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), coinsLimit, nFakeFeeTx);

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
            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), coinsLimit, nFakeFeeTx);

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
                    "test": "<(){await delegatecall('${strNestedContractAddr}', {method: 'test', arrArguments: []})}",
                    "throws": "<(){await delegatecall('${strNestedContractAddr}', {method: 'throws', arrArguments: []})}"
                }`,
                conciliumId: 0
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
            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), coinsLimit, nFakeFeeTx);

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
            await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), coinsLimit, nFakeFeeTx);

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
        const strTxHash = pseudoRandomBuffer().toString('hex');
        let patchThisTx;

        function setVariables(node, coinsLimit) {
            patchThisTx = new factory.PatchDB();
            node._app.setupVariables({
                coinsLimit,

                objFees: {
                    nFeeContractInvocation: factory.Constants.fees.CONTRACT_INVOCATION_FEE,
                    nFeeSize: nFakeFeeTx,
                    nFeeStorage: nFakeFeeDataSize,
                    nFeeInternalTx: factory.Constants.fees.INTERNAL_TX_FEE
                }
            });
            node._app.setCallbacks(
                node._createCallbacksForApp(
                    new factory.PatchDB(),
                    patchThisTx,
                    strTxHash
                ));
        }

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

        it('should FAIL (not enough coins)', async () => {
            coinsLimit = factory.Constants.fees.CONTRACT_INVOCATION_FEE + factory.Constants.fees.INTERNAL_TX_FEE;
            setVariables(node, coinsLimit);

            return assert.isRejected(node._app.runContract(
                createObjInvocationCode('test', [strAddress, contractBalance + 1]),
                contract,
                env,
                undefined
            ), 'Not enough funds for "send"');
        });

        it('should FAIL (not enough coins to run contract)', async () => {
            coinsLimit = factory.Constants.fees.CONTRACT_INVOCATION_FEE + factory.Constants.fees.INTERNAL_TX_FEE - 1;
            setVariables(node, coinsLimit);

            return assert.isRejected(node._app.runContract(
                createObjInvocationCode('test', [strAddress, contractBalance]),
                contract,
                env,
                undefined
            ), 'Contract run out of coins');
        });

        it('should Success (send all moneys)', async () => {
            coinsLimit = factory.Constants.fees.CONTRACT_INVOCATION_FEE + factory.Constants.fees.INTERNAL_TX_FEE;
            setVariables(node, coinsLimit);

            await node._app.runContract(
                createObjInvocationCode('test', [strAddress, contractBalance]),
                contract,
                env,
                undefined
            );

            const receipt = patchThisTx.getReceipt(strTxHash);

            const arrInternalTxns = [...receipt.getInternalTxns()];
            assert.equal(arrInternalTxns.length, 1);

            assert.equal(contract.getBalance(), 0);
        });
    });

    describe('Nested contract calls', () => {
        let node;
        let contract;
        const strAddress = generateAddress().toString('hex');
        const strTxHash = pseudoRandomBuffer().toString('hex');
        let env;
        let patchThisTx;
        const nFakeFeeTx = 7e3;
        const nFakeFeeDataSize = 20;

        function setVariables(node, coinsLimit) {
            patchThisTx = new factory.PatchDB();

            node._app.setupVariables({
                coinsLimit,
                objFees: {
                    nFeeContractInvocation: factory.Constants.fees.CONTRACT_INVOCATION_FEE,
                    nFeeSize: nFakeFeeTx,
                    nFeeStorage: nFakeFeeDataSize,
                    nFeeInternalTx: factory.Constants.fees.INTERNAL_TX_FEE
                }
            });

            node._app.setCallbacks(node._createCallbacksForApp(
                new factory.PatchDB(),
                patchThisTx,
                strTxHash
            ));
        }

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
            setVariables(node, factory.Constants.fees.CONTRACT_INVOCATION_FEE - 1);

            return assert.isRejected(node._app.runContract(
                createObjInvocationCode('test', [strAddress, 'test', 1, 2, 3, 4]),
                contract,
                env,
                undefined
            ), 'Contract run out of coins');
        });

        it('should FAIL to call (contract not found)', async () => {
            setVariables(node, factory.Constants.fees.CONTRACT_INVOCATION_FEE);

            return assert.isRejected(node._app.runContract(
                createObjInvocationCode('test', [strAddress, 'test', 1, 2, 3, 4]),
                contract,
                env,
                undefined
            ), 'Contract not found!');
        });

        it('should FAIL to call (trying to pass more coins than have)', async () => {
            const coinsLimit = 2 * factory.Constants.fees.CONTRACT_INVOCATION_FEE;
            setVariables(node, coinsLimit - 1);
            contract = new factory.Contract({
                contractCode: `{"test": "<(strAddress, method, ...arrArguments){await call(strAddress, {method, arrArguments, coinsLimit: ${coinsLimit}})}"}`
            });

            return assert.isRejected(node._app.runContract(
                createObjInvocationCode('test', [strAddress, 'test', 1, 2, 3, 4]),
                contract,
                env,
                undefined
            ), 'Trying to pass more coins than have');
        });

        it('should FAIL to call (trying to pass negative coinsLimit)', async () => {
            const coinsLimit = 2 * factory.Constants.fees.CONTRACT_INVOCATION_FEE;
            setVariables(node, coinsLimit);

            contract = new factory.Contract({
                contractCode: `{"test": "<(strAddress, method, ...arrArguments){await call(strAddress, {method, arrArguments, coinsLimit: -1})}"}`
            });

            return assert.isRejected(node._app.runContract(
                createObjInvocationCode('test', [strAddress, 'test', 1, 2, 3, 4]),
                contract,
                env,
                undefined
            ), 'coinsLimit should be positive');
        });

        it('should SUCCESSFULLY "call" nested contract with nested send', async () => {
            const nAmountToSend = 1e3;
            const coinsLimit = 2 * factory.Constants.fees.CONTRACT_INVOCATION_FEE +
                               2 * factory.Constants.fees.INTERNAL_TX_FEE +
                               nFakeFeeTx +
                               nAmountToSend;

            const strReceiver = generateAddress().toString('hex');
            const result = 42;
            const objCode = {
                "test": `<(strAddress){
                            const result=await call(strAddress, {method: "testAnother", arrArguments: [strAddress]});
                            if(!result) throw new Error('Error while invoking contract');
                            this._receivers[strAddress]=2;
                            return result;
                        }`
            };
            const strContractCallerAddr = generateAddress().toString('hex');
            contract = new factory.Contract({
                contractData: {_receivers: {[generateAddress().toString('hex')]: 1}},
                contractCode: JSON.stringify((objCode)),
                balance: 0
            }, strContractCallerAddr);

            const objCode2 = {
                "testAnother": `<(strAddress){this._someSecondContractVal++; send(strAddress, ${nAmountToSend}); return ${result};}`
            };
            const strContractSenderAddr = generateAddress().toString('hex');
            const contract2 = new factory.Contract({
                contractData: {_someSecondContractVal: 100},
                contractCode: JSON.stringify((objCode2)),
                balance: 1e10
            }, strContractSenderAddr);

            node._getContractByAddr = sinon.fake.resolves(contract2);

            setVariables(node, coinsLimit);

            const answer = await node._app.runContract(
                createObjInvocationCode('test', [strReceiver]),
                contract,
                env,
                undefined
            );

            assert.equal(answer, result);

            const nExpectedFee = 2 * factory.Constants.fees.CONTRACT_INVOCATION_FEE +
                                 factory.Constants.fees.INTERNAL_TX_FEE;
            assert.equal(node._app.coinsSpent(), nExpectedFee);

            const txReceipt = patchThisTx.getReceipt(strTxHash);
            assert.isOk(txReceipt instanceof factory.TxReceipt);
            assert.equal(txReceipt.getStatus(), factory.Constants.TX_STATUS_OK);

            patchThisTx.setContract(contract);

            // moneys sent in contract2 present?
            assert.equal(txReceipt.getInternalTxns().length, 1);

            {
                // new data of contract
                const contractCaller = patchThisTx.getContract(strContractCallerAddr);
                assert.isOk(contractCaller);
                const {_receivers} = contractCaller.getData();
                assert.equal(Object.keys(_receivers).length, 2);
                assert.isOk(_receivers[strReceiver]);

                // new data of contract2
                const contractSender = patchThisTx.getContract(strContractSenderAddr);
                assert.isOk(contractSender);
                const {_someSecondContractVal} = contractSender.getData();
                assert.equal(_someSecondContractVal, 101);

                // new balance of contract2
                assert.equal(contractSender.getBalance(), 1e10 - nAmountToSend);
            }
        });

        it('should SUCCESSFULLY "delegatecall" nested contract', async () => {
            const result = 42;
            const nBalanceCaller = 1e4;
            const nBalanceSender = 1e10;
            const nAmountToSend = 100;
            const nNumOfNestedSend = 3;
            const nFakeFeeSize = 4e3;
            const coinsLimit = 2 * factory.Constants.fees.CONTRACT_INVOCATION_FEE +
                               nNumOfNestedSend * factory.Constants.fees.INTERNAL_TX_FEE +
                               nFakeFeeSize +
                               1000 * factory.Constants.fees.STORAGE_PER_BYTE_FEE;
            // first contract will call second contract and set internal _receivers with argument address
            const strReceiver = generateAddress().toString('hex');
            const objCode = {
                "test": `<(strAddress){
                            const success=await delegatecall(strAddress, {method: "testAnother", arrArguments: [strAddress]});
                            if(!success) throw new Error('Error while invoking contract');
                            this._receivers[strAddress]=1;
                            return ${result}
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
                    this._receivers['test']=2;
                    for(let i=0; i< ${nNumOfNestedSend};i++) send(strAddress, ${nAmountToSend});
                    return true;
                }`
            };
            const strContractSenderAddr = generateAddress().toString('hex');
            const contract2 = new factory.Contract({
                contractData: {_someSecondContractVal: 100},
                contractCode: JSON.stringify((objCode2)),
                balance: nBalanceSender
            }, strContractSenderAddr);

            node._getContractByAddr = sinon.fake.resolves(contract2);

            setVariables(node, coinsLimit);

            const answer = await node._app.runContract(
                createObjInvocationCode('test', [strReceiver]),
                contract,
                env
            );

            assert.equal(answer, result);

            const nExpectedFee = 2 * factory.Constants.fees.CONTRACT_INVOCATION_FEE +
                                 nNumOfNestedSend * factory.Constants.fees.INTERNAL_TX_FEE;
            assert.equal(node._app.coinsSpent(), nExpectedFee);

            patchThisTx.setContract(contract);
            const receiptResult = patchThisTx.getReceipt(strTxHash);
            assert.equal(receiptResult.getInternalTxns().length, nNumOfNestedSend);

            {
                // new data of contract
                const contractCaller = patchThisTx.getContract(strContractCallerAddr);
                assert.isOk(contractCaller);

                const {_receivers} = contractCaller.getData();
                assert.equal(Object.keys(_receivers).length, 3);
                assert.isOk(_receivers[strReceiver]);
                assert.isOk(_receivers['test']);

                // balance of original contract was changed
                assert.equal(contractCaller.getBalance(), nBalanceCaller - nNumOfNestedSend * nAmountToSend);

                // OLD! data of contract2
                const contractSender = patchThisTx.getContract(strContractSenderAddr);
                assert.isOk(contractSender);

                const {_someSecondContractVal, _receivers: secondReceivers} = contractSender.getData();
                assert.equal(_someSecondContractVal, 100);
                assert.notOk(secondReceivers);
            }
        });

        it('should NOT ALTER contract data, even if "delegatecall" failed', async () => {
            const nBalanceCaller = 1e4;
            const nBalanceSender = 1e10;
            const nNumOfNestedSend = 3;
            const nFakeFeeSize = 4e3;
            const coinsLimit = 2 * factory.Constants.fees.CONTRACT_INVOCATION_FEE +
                               nNumOfNestedSend * factory.Constants.fees.INTERNAL_TX_FEE +
                               nFakeFeeSize +
                               1000 * factory.Constants.fees.STORAGE_PER_BYTE_FEE;
            // first contract will call second contract and set internal _receivers with argument address
            const strReceiver = generateAddress().toString('hex');
            const objCode = {
                "test": `<(strAddress){
                            this._receivers[strAddress]=1;

                            const success=await delegatecall(strAddress, {method: "testAnother", arrArguments: [strAddress]});
                            if(!success) throw new Error('Error while invoking contract');
                            return 42;
                        }`
            };
            const strContractCallerAddr = generateAddress().toString('hex');
            contract = new factory.Contract({
                contractData: {_receivers: {[generateAddress().toString('hex')]: 1}},
                contractCode: JSON.stringify((objCode)),
                balance: nBalanceCaller,
                conciliumId: 0
            }, strContractCallerAddr);

            const objCode2 = {
                "testAnother": `<(strAddress){
                    throw(0);
                }`
            };
            const strContractSenderAddr = generateAddress().toString('hex');
            const contract2 = new factory.Contract({
                contractData: {_someSecondContractVal: 100},
                contractCode: JSON.stringify((objCode2)),
                balance: nBalanceSender,
                conciliumId: 0
            }, strContractSenderAddr);

            node._getContractByAddr = sinon.fake.resolves(contract2);
            const fakeTx = {
                constructor: {name: 'Transaction'},
                conciliumId: 0,
                getSize: () => 100,
                hash: () => strTxHash,
                getHash: () => strTxHash,
                getTxSignerAddress: () => generateAddress().toString('hex'),
                getContractCode: () => JSON.stringify(createObjInvocationCode('test', [strReceiver])),
                getContractSentAmount: () => 0,
                getContractChangeReceiver: () => generateAddress()
            };
            const patchThisTx = new factory.PatchDB();

            await node._processContract(
                false,
                contract,
                fakeTx,
                patchThisTx,
                new factory.PatchDB(),
                coinsLimit,
                0
            );

            const nExpectedFee = 2 * factory.Constants.fees.CONTRACT_INVOCATION_FEE;
            assert.equal(node._app.coinsSpent(), nExpectedFee);

            assert.isNotOk(patchThisTx.getContract(strContractCallerAddr));
            assert.isNotOk(patchThisTx.getContract(strContractSenderAddr));

            // change (+ moneys sent to contract) is created
            const receipt = patchThisTx.getReceipt(fakeTx.hash());
            assert.equal(receipt.getInternalTxns().length, 1);

        });
    });

    describe('Encode data on demand', () => {
        it('should serialize only once', async () => {
            const buffFakeSerializedData = Buffer.from('fake');

            const contract = new factory.Contract({
                contractData: {a: 1},
                contractCode: '{"add": "(a){this.value+=a;}"}',
                conciliumId: 1
            });
            contract._serialize = sinon.fake.returns(buffFakeSerializedData);
            contract._deserialize = sinon.fake();

            contract.getDataSize();
            contract.getData();
            contract.encode();
            contract.getData();

            assert.isOk(contract._serialize.calledOnce);
            assert.equal(contract._deserialize.callCount, 0);
        });

        it('should invalidate cache (serialize again after updateData)', async () => {
            const buffFakeSerializedData = Buffer.from('fake');

            const contract = new factory.Contract({
                contractData: {a: 1},
                contractCode: '{"add": "(a){this.value+=a;}"}',
                conciliumId: 1
            });
            contract._serialize = sinon.fake.returns(buffFakeSerializedData);
            contract._deserialize = sinon.fake();
            contract.getDataSize();

            contract.updateData({a: 'new data'});

            contract.getDataSize();
            contract.getData();
            contract.encode();
            contract.getData();

            assert.equal(contract._serialize.callCount, 2);
            assert.equal(contract._deserialize.callCount, 0);
        });

        it('should cache (created from Buffer)', async () => {
            const encodedContractSample = '0a077b2261223a317d1224227b5c226164645c223a205c222861297b746869732e76616c75652b3d613b7d5c227d2218012100000000000000002802;';
            const buffFakeSerializedData = Buffer.from('fake');

            const contract = new factory.Contract(Buffer.from(encodedContractSample, 'hex'));

            contract._serialize = sinon.fake();
            contract._deserialize = sinon.fake.returns(buffFakeSerializedData);

            contract.getDataSize();
            assert.equal(contract._deserialize.callCount, 0);

            contract.getData();
            contract.encode();
            contract.getData();
            contract.getDataSize();

            assert.equal(contract._serialize.callCount, 0);
            assert.equal(contract._deserialize.callCount, 1);
        });

        it('should invalidate cache (created from Buffer)', async () => {
            const encodedContractSample = '0a077b2261223a317d1224227b5c226164645c223a205c222861297b746869732e76616c75652b3d613b7d5c227d2218012100000000000000002802;';
            const buffFakeSerializedData = Buffer.from('fake');
            const objFakeDeSerializedData = {a: 17};

            const contract = new factory.Contract(Buffer.from(encodedContractSample, 'hex'));

            contract._serialize = sinon.fake.returns(buffFakeSerializedData);
            contract._deserialize = sinon.fake.returns(objFakeDeSerializedData);

            contract.getData();
            assert.equal(contract._deserialize.callCount, 1);

            contract.updateData({a: 'new data'});
            contract.getData();
            assert.equal(contract._serialize.callCount, 0);

            contract.encode();
            contract.getDataSize();

            assert.equal(contract._serialize.callCount, 1);
            assert.equal(contract._deserialize.callCount, 1);
        });
    });
});
