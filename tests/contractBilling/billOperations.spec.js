'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
chai.use(require('chai-as-promised'));

const {assert} = chai;

const {generateAddress} = require('../testUtil');
const {ADD, MUL, SUB, DIV, MOD, CALLCODE, LOOPITER} = require('../../structures/babel/billingPrice');

let keyPair;
let privateKey;
let publicKey;

const factory = require('../testFactory');

describe('Contract billing: bill operations', () => {
    before(async () => {
        await factory.asyncLoad();
        keyPair = factory.Crypto.createKeyPair();
        privateKey = keyPair.getPrivate();
        publicKey = keyPair.getPublic();
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

    it('should reduce balance by ADD operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ 1 + 1; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        );

        assert.equal(initialCoins - ADD, app._nCoinsLimit);
    });

    it('should reduce balance by SUB operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ 1 - 1; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        );

        assert.equal(initialCoins - SUB, app._nCoinsLimit);
    });

    it('should reduce balance by MUL operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ 2 * 3; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        );

        assert.equal(initialCoins - MUL, app._nCoinsLimit);
    });

    it('should reduce balance by DIV operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ 10 / 2; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        );

        assert.equal(initialCoins - DIV, app._nCoinsLimit);
    });

    it('should reduce balance by MOD operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ 9 % 2; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        );

        assert.equal(initialCoins - MOD, app._nCoinsLimit);
    });

    it('should reduce balance by complex operation cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ 1 + 4 * 3 / 2 - 1 % 3; }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        );

        assert.equal(initialCoins - ADD - MUL - DIV - SUB - MOD, app._nCoinsLimit);
    });

    it('should reduce balance by function call cost', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ function f() {}; f(); }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        );

        assert.equal(initialCoins - CALLCODE, app._nCoinsLimit);
    });

    it('should reduce balance by "for" loop iterations cost', async () => {
        const loopIterations = 7;
        const contract = new factory.Contract({
            contractCode: `{"test": "(){ for (let i=0; i<${loopIterations}; i++); }"}`,
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        );

        assert.equal(initialCoins - LOOPITER * loopIterations, app._nCoinsLimit);
    });

    it('should reduce balance by "while" loop iterations cost', async () => {
        const loopIterations = 5;
        const contract = new factory.Contract({
            contractCode: `{"test": "(){ let i = 0; while (i++ < ${loopIterations}); }"}`,
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        );

        assert.equal(initialCoins - LOOPITER * loopIterations, app._nCoinsLimit);
    });

    it('should reduce balance by "do while" loop iterations cost', async () => {
        const loopIterations = 9;
        const contract = new factory.Contract({
            contractCode: `{"test": "(){ let i = 0; do ; while (i++ < ${loopIterations}) }"}`,
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        );

        assert.equal(initialCoins - LOOPITER * (loopIterations + 1), app._nCoinsLimit);
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
        app.createContract(
            strCode,
            {contractAddr: 'hash', callerAddress}
        );
        assert.equal(initialCoins - CONTRACT_CREATION_FEE - ADD, app._nCoinsLimit);
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
        app.createContract(
            strCode,
            {contractAddr: 'hash', callerAddress}
        );
        assert.equal(initialCoins - CONTRACT_CREATION_FEE - SUB, app._nCoinsLimit);
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
        app.createContract(
            strCode,
            {contractAddr: 'hash', callerAddress}
        );
        assert.equal(initialCoins - CONTRACT_CREATION_FEE - MUL, app._nCoinsLimit);
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
        app.createContract(
            strCode,
            {contractAddr: 'hash', callerAddress}
        );
        assert.equal(initialCoins - CONTRACT_CREATION_FEE - DIV, app._nCoinsLimit);
    });
});
