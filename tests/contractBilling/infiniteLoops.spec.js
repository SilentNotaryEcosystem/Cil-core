'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
chai.use(require('chai-as-promised'));

const {assert} = chai;

const {generateAddress} = require('../testUtil');
const {LOOPITER} = require('../../structures/babel/billingPrice');

let keyPair;
let privateKey;
let publicKey;

const factory = require('../testFactory');

describe('Contract billing: Infinite loop breaking using loop iteration cost', () => {
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
    const ContractRunOutOfCoinsText = 'Contract run out of coins';

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

    it('should throw an exception for the infinite loop: for (;;);', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ for (;;); }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        assert.isRejected(app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        ), ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop: for (;;) {}', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ for (;;) {} }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        assert.isRejected(app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        ), ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop: for (;;) { continue; }', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ for (;;) { continue; } }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        assert.isRejected(app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        ), ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop: while (true);', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ while (true); }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        assert.isRejected(app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        ), ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop: while (true) {}', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ while (true) {} }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        assert.isRejected(app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        ), ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop: while (true) { continue; }', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ while (true) { continue; } }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        assert.isRejected(app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        ), ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop: do ; while (true);', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ do ; while (true); }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        assert.isRejected(app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        ), ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop: do {} while (true);', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ do {} while (true); }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        assert.isRejected(app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        ), ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop: do { continue; } while (true);', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ do { continue; } while (true); }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        assert.isRejected(app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        ), ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite recursion: function f() { f(); } f();', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ function f() { f(); } f(); }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        assert.isRejected(app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        ), ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite recursion: function f() { f(); }; f();', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ function f() { f(); }; f() }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        assert.isRejected(app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        ), ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite recursion: function f1() { f2(); } function f2() { f1(); } f1();', async () => {
        const contract = new factory.Contract({
            contractCode: '{"test": "(){ function f1() { f2(); } function f2() { f1(); } f1(); }"}',
            conciliumId: 10
        });

        const initialCoins = app._nCoinsLimit;
        assert.isRejected(app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {}, undefined
        ), ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop in class: for (;;);', async () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    for (;;);
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');
        const createContract = () => app.createContract(
            strCode,
            {contractAddr: 'hash', callerAddress}
        );

        const initialCoins = app._nCoinsLimit;
        assert.throws(createContract, ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop in a class: for (;;) {}', async () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    for (;;) {}
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');
        const createContract = () => app.createContract(
            strCode,
            {contractAddr: 'hash', callerAddress}
        );

        const initialCoins = app._nCoinsLimit;
        assert.throws(createContract, ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop in a class: for (;;) { continue; }', async () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    for (;;) { continue; }
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');
        const createContract = () => app.createContract(
            strCode,
            {contractAddr: 'hash', callerAddress}
        );

        const initialCoins = app._nCoinsLimit;
        assert.throws(createContract, ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop in a class: while (true);', async () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    while (true);
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');
        const createContract = () => app.createContract(
            strCode,
            {contractAddr: 'hash', callerAddress}
        );

        const initialCoins = app._nCoinsLimit;
        assert.throws(createContract, ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop in a class: while (true) {}', async () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    while (true) {}
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');
        const createContract = () => app.createContract(
            strCode,
            {contractAddr: 'hash', callerAddress}
        );

        const initialCoins = app._nCoinsLimit;
        assert.throws(createContract, ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop in a class: while (true) { continue; }', async () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    while (true) { continue; }
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');
        const createContract = () => app.createContract(
            strCode,
            {contractAddr: 'hash', callerAddress}
        );

        const initialCoins = app._nCoinsLimit;
        assert.throws(createContract, ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop in a class: do ; while (true);', async () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    do ; while (true);
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');
        const createContract = () => app.createContract(
            strCode,
            {contractAddr: 'hash', callerAddress}
        );

        const initialCoins = app._nCoinsLimit;
        assert.throws(createContract, ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop in a class: do {} while (true);', async () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    do {} while (true);
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');
        const createContract = () => app.createContract(
            strCode,
            {contractAddr: 'hash', callerAddress}
        );

        const initialCoins = app._nCoinsLimit;
        assert.throws(createContract, ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });

    it('should throw an exception for the infinite loop in a class: do { continue; } while (true);', async () => {
        const strCode = `
            class A extends Base {
                constructor(){
                    super();
                    do { continue; } while (true);
                }
            }
            exports=new A();
            `;
        const callerAddress = generateAddress().toString('hex');
        const createContract = () => app.createContract(
            strCode,
            {contractAddr: 'hash', callerAddress}
        );

        const initialCoins = app._nCoinsLimit;
        assert.throws(createContract, ContractRunOutOfCoinsText);
        assert.equal(initialCoins % LOOPITER, app._nCoinsLimit)
    });
});
