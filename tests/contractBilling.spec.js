'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
chai.use(require('chai-as-promised'));

const {assert} = chai;

const {generateAddress} = require('./testUtil');

let keyPair;
let privateKey;
let publicKey;

const factory = require('./testFactory');

describe('Tests of contract billing', () => {
    before(async () => {
        await factory.asyncLoad();
        keyPair = factory.Crypto.createKeyPair();
        privateKey = keyPair.getPrivate();
        publicKey = keyPair.getPublic();
    });

    describe('Check unsupported operations', () => {
        const UnsupportedExceptionText = 'Found unsupported operation in the contract!';

        it('should not allow to create a contract with a dangerous operation and throw an exception: process.exit()', () => {
            const strCode = '{ process.exit(1); }';
            const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
            assert.throws(createContract, UnsupportedExceptionText);
        });

        it('should not allow to create a contract with a dangerous operation and throw an exception: Math.random();', () => {
            const strCode = '{ class A { testMethod() { return Math.random(); } } }';
            const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
            assert.throws(createContract, UnsupportedExceptionText);
        })

        it('should not allow to create a contract with a dangerous operation and throw an exception: eval();', () => {
            const strCode = '{ function test() { eval("process.exit(1);"); } }';
            const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
            assert.throws(createContract, UnsupportedExceptionText);
        })

        it('should not throw an exception for the contract without a dangerous operation', () => {
            const strCode = '{}';
            const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
            assert.doesNotThrow(createContract);
        })
    });

    describe('Check infinite loop breaking using loop iteration cost', () => {
        let nFeeContractInvocation;
        let nFeeContractCreation;
        let nFeeStorage;
        let nFeeSizeFakeTx;
        let app;
        const ContractRunOutOfCoinsText = 'Contract run out of coins';

        beforeEach(() => {
            nFeeContractInvocation = factory.Constants.fees.CONTRACT_INVOCATION_FEE;
            nFeeContractCreation = factory.Constants.fees.CONTRACT_CREATION_FEE;
            nFeeStorage = factory.Constants.fees.STORAGE_PER_BYTE_FEE;
            nFeeSizeFakeTx = 100;

            app = new factory.Application();
            app.setupVariables({
                coinsLimit: 10000,
                objFees: {
                    nFeeContractInvocation,
                    nFeeSize: nFeeSizeFakeTx,
                    nFeeStorage
                }
            });
        });

        it('should throw an exception for the infinite loop: for (;;);', async () => {
            const contract = new factory.Contract({
                contractData: {value: 100},
                contractCode: '{"add": "(a){ for (;;); }"}',
                conciliumId: 10
            });

            assert.isRejected(app.runContract(
                {method: 'add', arrArguments: [10]},
                contract,
                {}, undefined
            ), ContractRunOutOfCoinsText);
        });

        it('should throw an exception for the infinite loop: for (;;) {}', async () => {
            const contract = new factory.Contract({
                contractData: {value: 100},
                contractCode: '{"add": "(a){ for (;;) {} }"}',
                conciliumId: 10
            });

            assert.isRejected(app.runContract(
                {method: 'add', arrArguments: [10]},
                contract,
                {}, undefined
            ), ContractRunOutOfCoinsText);
        });

        it('should throw an exception for the infinite loop: for (;;) { continue; }', async () => {
            const contract = new factory.Contract({
                contractData: {value: 100},
                contractCode: '{"add": "(a){ for (;;) { continue; } }"}',
                conciliumId: 10
            });

            assert.isRejected(app.runContract(
                {method: 'add', arrArguments: [10]},
                contract,
                {}, undefined
            ), ContractRunOutOfCoinsText);
        });

        it('should throw an exception for the infinite loop: while (true);', async () => {
            const contract = new factory.Contract({
                contractData: {value: 100},
                contractCode: '{"add": "(a){ while (true); }"}',
                conciliumId: 10
            });

            assert.isRejected(app.runContract(
                {method: 'add', arrArguments: [10]},
                contract,
                {}, undefined
            ), ContractRunOutOfCoinsText);
        });

        it('should throw an exception for the infinite loop: while (true) {}', async () => {
            const contract = new factory.Contract({
                contractData: {value: 100},
                contractCode: '{"add": "(a){ while (true) {} }"}',
                conciliumId: 10
            });

            assert.isRejected(app.runContract(
                {method: 'add', arrArguments: [10]},
                contract,
                {}, undefined
            ), ContractRunOutOfCoinsText);
        });

        it('should throw an exception for the infinite loop: while (true) { continue; }', async () => {
            const contract = new factory.Contract({
                contractData: {value: 100},
                contractCode: '{"add": "(a){ while (true) { continue; } }"}',
                conciliumId: 10
            });

            assert.isRejected(app.runContract(
                {method: 'add', arrArguments: [10]},
                contract,
                {}, undefined
            ), ContractRunOutOfCoinsText);
        });

        it('should throw an exception for the infinite loop: do ; while (true);', async () => {
            const contract = new factory.Contract({
                contractData: {value: 100},
                contractCode: '{"add": "(a){ do ; while (true); }"}',
                conciliumId: 10
            });

            assert.isRejected(app.runContract(
                {method: 'add', arrArguments: [10]},
                contract,
                {}, undefined
            ), ContractRunOutOfCoinsText);
        });

        it('should throw an exception for the infinite loop: do {} while (true);', async () => {
            const contract = new factory.Contract({
                contractData: {value: 100},
                contractCode: '{"add": "(a){ do {} while (true); }"}',
                conciliumId: 10
            });

            assert.isRejected(app.runContract(
                {method: 'add', arrArguments: [10]},
                contract,
                {}, undefined
            ), ContractRunOutOfCoinsText);
        });

        it('should throw an exception for the infinite loop: do { continue; } while (true);', async () => {
            const contract = new factory.Contract({
                contractData: {value: 100},
                contractCode: '{"add": "(a){ do { continue; } while (true); }"}',
                conciliumId: 10
            });

            assert.isRejected(app.runContract(
                {method: 'add', arrArguments: [10]},
                contract,
                {}, undefined
            ), ContractRunOutOfCoinsText);
        });

        it('should throw an exception for the infinite recursion: function f() { f(); } f();', async () => {
            const contract = new factory.Contract({
                contractData: {value: 100},
                contractCode: '{"add": "(a){ function f() { f(); } f(); }"}',
                conciliumId: 10
            });

            assert.isRejected(app.runContract(
                {method: 'add', arrArguments: [10]},
                contract,
                {}, undefined
            ), ContractRunOutOfCoinsText);
        });

        it('should throw an exception for the infinite recursion: const f = () => { f(); }; f();', async () => {
            const contract = new factory.Contract({
                contractData: {value: 100},
                contractCode: '{"add": "(a){ const f = () => { f(); }; f(); }"}',
                conciliumId: 10
            });

            assert.isRejected(app.runContract(
                {method: 'add', arrArguments: [10]},
                contract,
                {}, undefined
            ), ContractRunOutOfCoinsText);
        });

        it('should throw an exception for the infinite recursion: function f1() { f2(); } function f2() { f1(); } f1();', async () => {
            const contract = new factory.Contract({
                contractData: {value: 100},
                contractCode: '{"add": "(a){ function f1() { f2(); } function f2() { f1(); } f1(); }"}',
                conciliumId: 10
            });

            assert.isRejected(app.runContract(
                {method: 'add', arrArguments: [10]},
                contract,
                {}, undefined
            ), ContractRunOutOfCoinsText);
        });
    });
})
