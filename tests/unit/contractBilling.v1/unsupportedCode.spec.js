'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('../../testFactory');
const UnsupportedExceptionText = 'Found unsupported operation in the contract!';

describe('Contract billing: Check unsupported operations', () => {
    before(async () => {
        await factory.asyncLoad();
    });

    let nFeeContractInvocation;
    let nFeeContractCreation;
    let nFeeStorage;
    let nFeeSizeFakeTx;
    let app;

    const CONTRACT_CREATION_FEE = 100;

    beforeEach(() => {
        nFeeContractInvocation = factory.Constants.fees.CONTRACT_INVOCATION_FEE;
        nFeeContractCreation = CONTRACT_CREATION_FEE;
        nFeeStorage = factory.Constants.fees.STORAGE_PER_BYTE_FEE;
        nFeeSizeFakeTx = 100;

        app = new factory.Application();
        app.setupVariables({
            coinsLimit: 10000,
            objFees: {
                nFeeContractInvocation,
                nFeeContractCreation,
                nFeeSize: nFeeSizeFakeTx,
                nFeeStorage
            }
        });
    });

    it('should not allow to create a contract with a dangerous operation and throw an exception: process.exit()', () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ process.exit(1); }"}',
            conciliumId: 10
        });
        assert.isRejected(
            app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1),
            UnsupportedExceptionText
        );
    });

    it('should not allow to create a contract with a dangerous operation and throw an exception: Math.random();', () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ Math.random(); }"}',
            conciliumId: 10
        });
        assert.isRejected(
            app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1),
            UnsupportedExceptionText
        );
    });

    it('should not allow to create a contract with a dangerous operation and throw an exception: eval();', () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ eval(`process.exit(1)`); }"}',
            conciliumId: 10
        });
        assert.isRejected(
            app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1),
            UnsupportedExceptionText
        );
    });

    it('should not allow to create a contract with an arrow function', () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ const f = () => {}; }"}',
            conciliumId: 10
        });
        assert.isRejected(
            app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1),
            UnsupportedExceptionText
        );
    });

    it('should not throw an exception for the contract without a dangerous operation', () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){}"}',
            conciliumId: 10
        });
        assert.isOk(app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1));
    });

    it('should not allow to create a contract with a string regex', () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ let a = /^TEST$/; }"}',
            conciliumId: 10
        });
        assert.isRejected(
            app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1),
            UnsupportedExceptionText
        );
    });

    it('should not allow to create a contract with a string regex test', () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ /.*/gi.test(`test`); }"}',
            conciliumId: 10
        });
        assert.isRejected(
            app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1),
            UnsupportedExceptionText
        );
    });

    it('should not allow to create a contract with a string regex replace', () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ `ab`.replaceAll(/b/, `c`); }"}',
            conciliumId: 10
        });
        assert.isRejected(
            app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1),
            UnsupportedExceptionText
        );
    });

    it('should not allow to create a contract with an object regex', () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ let a = new RegExp(`^TEST$`); }"}',
            conciliumId: 10
        });
        assert.isRejected(
            app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1),
            UnsupportedExceptionText
        );
    });

    it('should not allow to create a contract with an object regex test', () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ new RegExp(`.*`, `gi`).test(`test`); }"}',
            conciliumId: 10
        });
        assert.isRejected(
            app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1),
            UnsupportedExceptionText
        );
    });

    it('should not allow to create a contract with an object regex replace', () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ `ab`.replaceAll(new RegExp(`b`), `c`); }"}',
            conciliumId: 10
        });
        assert.isRejected(
            app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1),
            UnsupportedExceptionText
        );
    });
});
