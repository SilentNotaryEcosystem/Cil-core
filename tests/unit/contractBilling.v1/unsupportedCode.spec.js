'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
chai.use(require('chai-as-promised'));

const {assert} = chai;

const {generateAddress} = require('../../testUtil');

const factory = require('../../testFactory');

const UnsupportedExceptionText = 'Found unsupported operation in the contract!';

describe('Contract billing: Infinite loop breaking using loop iteration cost', () => {
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
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    process.exit(1);
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');

        const createContract = () => app.createContract(strCode, {contractAddr: 'hash', callerAddress}, undefined, 1);
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not allow to create a contract with a dangerous operation and throw an exception: eval();', () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    eval('process.exit(1)');
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');

        const createContract = () => app.createContract(strCode, {contractAddr: 'hash', callerAddress}, undefined, 1);
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not allow to create a contract with a dangerous operation and throw an exception: Math.random();', () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    Math.random();
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');

        const createContract = () => app.createContract(strCode, {contractAddr: 'hash', callerAddress}, undefined, 1);
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not allow to create a contract with an arrow function', () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    const f = () => {};
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');

        const createContract = () => app.createContract(strCode, {contractAddr: 'hash', callerAddress}, undefined, 1);
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not throw an exception for the contract without a dangerous operation', () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');

        assert.isOk(app.createContract(strCode, {contractAddr: 'hash', callerAddress}, undefined, 1));
    });

    it('should not allow to create a contract with a string regex', () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    let a = /^TEST$/;
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');

        const createContract = () => app.createContract(strCode, {contractAddr: 'hash', callerAddress}, undefined, 1);
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not allow to create a contract with a string regex test', () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    /.*/gi.test('test');
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');

        const createContract = () => app.createContract(strCode, {contractAddr: 'hash', callerAddress}, undefined, 1);
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not allow to create a contract with a string regex replace', () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    'ab'.replaceAll(/b/, 'c');
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');

        const createContract = () => app.createContract(strCode, {contractAddr: 'hash', callerAddress}, undefined, 1);
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not allow to create a contract with an object regex', () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    let a = new RegExp('^TEST$');
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');

        const createContract = () => app.createContract(strCode, {contractAddr: 'hash', callerAddress}, undefined, 1);
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not allow to create a contract with an object regex test', () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    new RegExp('.*', 'gi').test('test');
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');

        const createContract = () => app.createContract(strCode, {contractAddr: 'hash', callerAddress}, undefined, 1);
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not allow to create a contract with an object regex replace', () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    'ab'.replaceAll(new RegExp('b'), 'c');
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');

        const createContract = () => app.createContract(strCode, {contractAddr: 'hash', callerAddress}, undefined, 1);
        assert.throws(createContract, UnsupportedExceptionText);
    });
});
