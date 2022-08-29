'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
const sinon = require('sinon').createSandbox();
chai.use(require('chai-as-promised'));
const {assert} = chai;

const factory = require('../testFactory');

const {pseudoRandomBuffer, generateAddress, createObjInvocationCode} = require('../testUtil');
const {ADD} = require('../../billing/v1/babel/billingPrice');

const CONTRACT_CREATION_FEE = factory.Constants.fees.CONTRACT_CREATION_FEE;
const CONTRACT_INVOCATION_FEE = factory.Constants.fees.CONTRACT_INVOCATION_FEE;

describe('Contract billing integration tests', () => {
    let node;
    let nCoinsIn;
    const nFakeFeeTx = 1e3;
    const nFakeFeeDataSize = 10;

    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    beforeEach(async () => {
        nCoinsIn = CONTRACT_CREATION_FEE + nFakeFeeTx + nFakeFeeDataSize * 1000;
        node = new factory.Node();
        node._calculateSizeFee = sinon.fake.resolves(nFakeFeeTx);
        node._getFeeStorage = sinon.fake.resolves(nFakeFeeDataSize);

        await node.ensureLoaded();
    });

    after(async function () {
        this.timeout(15000);
    });

    it('should deploy a contract (before 1st contract billing fork)', async () => {
        // data serialized to V8
        node._processedBlock = {
            getHeight: () => factory.Constants.forks.HEIGHT_FORK_CONTRACT_BILLING1 - 1,
            getHash: () => pseudoRandomBuffer().toString('hex'),
            timestamp: parseInt(Date.now() / 1000)
        };
        const patchTx = new factory.PatchDB();
        const contractCode = `
        class TestContract extends Base{
            constructor() {
                super();
                1 + 1;
            }
        };

        exports=new TestContract();
        `;
        const tx = factory.Transaction.createContract(contractCode, generateAddress());

        await node._processContract(false, undefined, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

        const receipt = patchTx.getReceipt(tx.hash());
        assert.isOk(receipt);
        assert.isOk(receipt.isSuccessful());
        assert.equal(node._app._nCoinsLimit, nCoinsIn - CONTRACT_CREATION_FEE - nFakeFeeTx);
    });

    it('should deploy a contract (after 1st contract billing fork)', async () => {
        // data serialized to V8
        node._processedBlock = {
            getHeight: () => factory.Constants.forks.HEIGHT_FORK_CONTRACT_BILLING1,
            getHash: () => pseudoRandomBuffer().toString('hex'),
            timestamp: parseInt(Date.now() / 1000)
        };
        const patchTx = new factory.PatchDB();
        const contractCode = `
        class TestContract extends Base{
            constructor() {
                super();
                1 + 1;
            }
        };

        exports=new TestContract();
        `;
        const tx = factory.Transaction.createContract(contractCode, generateAddress());

        await node._processContract(false, undefined, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

        const receipt = patchTx.getReceipt(tx.hash());
        assert.isOk(receipt);
        assert.isOk(receipt.isSuccessful());
        assert.equal(node._app._nCoinsLimit, nCoinsIn - CONTRACT_CREATION_FEE - nFakeFeeTx - ADD);
    });

    it('should run a contract (before 1st contract billing fork)', async () => {
        let strContractAddress = generateAddress().toString('hex');
        let contract = new factory.Contract(
            {
                contractData: {},
                contractCode: `{"test": "(){1+1;}"}`,
                conciliumId: 0
            },
            strContractAddress,
            factory.Constants.CONTRACT_V_V8
        );

        let tx = factory.Transaction.invokeContract(
            generateAddress().toString('hex'),
            createObjInvocationCode('test', []),
            1e5
        );

        const patchTx = new factory.PatchDB();
        node._processedBlock = {
            getHeight: () => factory.Constants.forks.HEIGHT_FORK_CONTRACT_BILLING1 - 1,
            getHash: () => pseudoRandomBuffer().toString('hex'),
            timestamp: parseInt(Date.now() / 1000)
        };

        await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

        const receipt = patchTx.getReceipt(tx.hash());
        assert.isOk(receipt);
        assert.isOk(receipt.isSuccessful());

        assert.equal(node._app._nCoinsLimit, nCoinsIn - CONTRACT_INVOCATION_FEE - nFakeFeeTx);
    });

    it('should run a contract (after 1st contract billing fork)', async () => {
        let strContractAddress = generateAddress().toString('hex');
        let contract = new factory.Contract(
            {
                contractData: {},
                contractCode: `{"test": "(){1+1;}"}`,
                conciliumId: 0
            },
            strContractAddress,
            factory.Constants.CONTRACT_V_V8
        );

        let tx = factory.Transaction.invokeContract(
            generateAddress().toString('hex'),
            createObjInvocationCode('test', []),
            1e5
        );

        const patchTx = new factory.PatchDB();
        node._processedBlock = {
            getHeight: () => factory.Constants.forks.HEIGHT_FORK_CONTRACT_BILLING1,
            getHash: () => pseudoRandomBuffer().toString('hex'),
            timestamp: parseInt(Date.now() / 1000)
        };

        await node._processContract(false, contract, tx, patchTx, new factory.PatchDB(), nCoinsIn, nFakeFeeTx);

        const receipt = patchTx.getReceipt(tx.hash());
        assert.isOk(receipt);
        assert.isOk(receipt.isSuccessful());

        assert.equal(node._app._nCoinsLimit, nCoinsIn - CONTRACT_INVOCATION_FEE - nFakeFeeTx - ADD);
    });
});
