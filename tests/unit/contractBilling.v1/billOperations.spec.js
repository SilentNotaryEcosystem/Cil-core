'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
chai.use(require('chai-as-promised'));

const {assert} = chai;

const {generateAddress} = require('../../testUtil');
const fees = require('../../../billing/v1/babel/billingFees');

const factory = require('../../testFactory');

const CONTRACT_CREATION_FEE = 100;
const CONTRACT_INVOCATION_FEE = factory.Constants.fees.CONTRACT_INVOCATION_FEE;

describe('Contract billing: bill operations', () => {
    before(async () => {
        await factory.asyncLoad();
    });

    let nFeeContractInvocation;
    let nFeeContractCreation;
    let nFeeStorage;
    let nFeeSizeFakeTx;
    let app;

    beforeEach(() => {
        nFeeContractInvocation = CONTRACT_INVOCATION_FEE;
        nFeeContractCreation = CONTRACT_CREATION_FEE;
        nFeeStorage = factory.Constants.fees.STORAGE_PER_BYTE_FEE;
        nFeeSizeFakeTx = 100;

        app = new factory.Application();
        app.setupVariables({
            coinsLimit: 100000,
            objFees: {
                nFeeContractInvocation,
                nFeeContractCreation,
                nFeeSize: nFeeSizeFakeTx,
                nFeeStorage
            }
        });
    });

    it('should reduce balance by ADD operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ 1 + 1; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(initialCoins - CONTRACT_INVOCATION_FEE - fees.ADD, app._nCoinsLimit);
    });

    it('should reduce balance by unary ADD operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ let a = 0; a += 1; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(initialCoins - CONTRACT_INVOCATION_FEE - fees.ADD, app._nCoinsLimit);
    });

    it('should reduce balance by INC operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ let a = 0; a++; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(initialCoins - CONTRACT_INVOCATION_FEE - fees.ADD, app._nCoinsLimit);
    });

    it('should reduce balance by SUB operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ 1 - 1; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(initialCoins - CONTRACT_INVOCATION_FEE - fees.SUB, app._nCoinsLimit);
    });

    it('should reduce balance by unary SUB operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ let a = 0; a -= 1; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(initialCoins - CONTRACT_INVOCATION_FEE - fees.SUB, app._nCoinsLimit);
    });

    it('should reduce balance by MUL operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ 2 * 3; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(initialCoins - CONTRACT_INVOCATION_FEE - fees.MUL, app._nCoinsLimit);
    });

    it('should reduce balance by unary MUL operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ let a = 2; a *= 3; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(initialCoins - CONTRACT_INVOCATION_FEE - fees.MUL, app._nCoinsLimit);
    });

    it('should reduce balance by DIV operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ 10 / 2; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(initialCoins - CONTRACT_INVOCATION_FEE - fees.DIV, app._nCoinsLimit);
    });

    it('should reduce balance by unary DIV operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ let a = 10; a /= 2; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(initialCoins - CONTRACT_INVOCATION_FEE - fees.DIV, app._nCoinsLimit);
    });

    it('should reduce balance by MOD operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ 9 % 2; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(initialCoins - CONTRACT_INVOCATION_FEE - fees.MOD, app._nCoinsLimit);
    });

    it('should reduce balance by unary MOD operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ let a = 9; a %= 2; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(initialCoins - CONTRACT_INVOCATION_FEE - fees.MOD, app._nCoinsLimit);
    });

    it('should reduce balance by EXP operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ 9 ** 2; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(initialCoins - CONTRACT_INVOCATION_FEE - fees.EXP, app._nCoinsLimit);
    });

    it('should reduce balance by unary EXP operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ let a = 9; a **= 2; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(initialCoins - CONTRACT_INVOCATION_FEE - fees.EXP, app._nCoinsLimit);
    });

    it('should reduce balance by complex operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ 1 + 4 * 3 / 2 - 1 % 3 > 1 === 2 !== 3 <= 4; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(
            initialCoins -
                CONTRACT_INVOCATION_FEE -
                fees.ADD -
                fees.MUL -
                fees.DIV -
                fees.SUB -
                fees.MOD -
                fees.GT -
                fees.EQ -
                fees.NOT -
                fees.SLT,
            app._nCoinsLimit
        );
    });

    it('should reduce balance by ADD operation cost for if operator', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ if (1 + 1); }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(initialCoins - CONTRACT_INVOCATION_FEE - fees.ADD, app._nCoinsLimit);
    });

    it('should reduce balance by function call cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ function f() {}; f(); }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(initialCoins - CONTRACT_INVOCATION_FEE - fees.CALLCODE, app._nCoinsLimit);
    });

    it('should reduce balance by "for" loop iterations cost', async () => {
        const loopIterations = 7;
        const contract = new factory.Contract({
            contractCode: `{"test": "(){ for (let i=0; i<${loopIterations}; i++); }"}`,
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(
            initialCoins - CONTRACT_INVOCATION_FEE - (fees.LOOPITER + fees.LT + fees.ADD) * loopIterations,
            app._nCoinsLimit
        );
    });

    it('should reduce balance by "while" loop iterations cost', async () => {
        const loopIterations = 5;
        const contract = new factory.Contract({
            contractCode: `{"test": "(){ let i = 0; while (i++ < ${loopIterations}); }"}`,
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(
            initialCoins - CONTRACT_INVOCATION_FEE - (fees.LOOPITER + fees.ADD + fees.LT) * loopIterations,
            app._nCoinsLimit
        );
    });

    it('should reduce balance by "do while" loop iterations cost', async () => {
        const loopIterations = 9;
        const contract = new factory.Contract({
            contractCode: `{"test": "(){ let i = 0; do ; while (i++ < ${loopIterations}) }"}`,
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract({method: 'test', arrArguments: []}, contract, {}, undefined, false, 1);

        assert.equal(
            initialCoins - CONTRACT_INVOCATION_FEE - (fees.LOOPITER + fees.ADD + fees.LT) * (loopIterations + 1),
            app._nCoinsLimit
        );
    });

    it('should reduce balance by ADD operation cost for an object', async () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    1 + 1;
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');

        const initialCoins = app._nCoinsLimit;
        app.createContract(strCode, {contractAddr: 'hash', callerAddress}, undefined, 1);
        assert.equal(initialCoins - CONTRACT_CREATION_FEE - fees.ADD, app._nCoinsLimit);
    });

    it('should reduce balance by SUB operation cost for an object', async () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    3 - 2;
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');

        const initialCoins = app._nCoinsLimit;
        app.createContract(strCode, {contractAddr: 'hash', callerAddress}, undefined, 1);
        assert.equal(initialCoins - CONTRACT_CREATION_FEE - fees.SUB, app._nCoinsLimit);
    });

    it('should reduce balance by MUL operation cost for an object', async () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    3 * 2;
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');

        const initialCoins = app._nCoinsLimit;
        app.createContract(strCode, {contractAddr: 'hash', callerAddress}, undefined, 1);
        assert.equal(initialCoins - CONTRACT_CREATION_FEE - fees.MUL, app._nCoinsLimit);
    });

    it('should reduce balance by DIV operation cost for an object', async () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    3 / 2;
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');

        const initialCoins = app._nCoinsLimit;
        app.createContract(strCode, {contractAddr: 'hash', callerAddress}, undefined, 1);
        assert.equal(initialCoins - CONTRACT_CREATION_FEE - fees.DIV, app._nCoinsLimit);
    });
});
