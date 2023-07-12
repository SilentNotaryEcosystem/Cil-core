'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
const sinon = require('sinon').createSandbox();
const debug = require('debug')('application:test');

chai.use(require('chai-as-promised'));
const {assert} = chai;

const factory = require('./testFactory');
const {pseudoRandomBuffer, generateAddress} = require('./testUtil');
const {arrayEquals} = require('../utils');

const createGenesis = async (factory, utxoHash) => {
    const patch = new factory.PatchDB(0);
    const keyPair = factory.Crypto.createKeyPair();
    const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

    // create "genesis"
    const coins = new factory.Coins(100000, buffAddress);
    patch.createCoins(utxoHash, 12, coins);
    patch.createCoins(utxoHash, 0, coins);
    patch.createCoins(utxoHash, 80, coins);

    const storage = new factory.Storage();
    await storage.applyPatch(patch);

    return {storage, keyPair};
};

describe('Application layer', () => {
    let nFeeContractInvocation;
    let nFeeContractCreation;
    let nFeeStorage;
    let nFeeSizeFakeTx;
    let coinsIn;
    let app;

    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    beforeEach(() => {
        nFeeContractInvocation = factory.Constants.fees.CONTRACT_INVOCATION_FEE;
        nFeeContractCreation = factory.Constants.fees.CONTRACT_CREATION_FEE;
        nFeeStorage = factory.Constants.fees.STORAGE_PER_BYTE_FEE;
        nFeeSizeFakeTx = 100;
        coinsIn = factory.Constants.fees.CONTRACT_INVOCATION_FEE +
                  1000 * factory.Constants.fees.STORAGE_PER_BYTE_FEE +
                  nFeeSizeFakeTx;

        app = new factory.Application();
        app.setupVariables({
            coinsLimit: coinsIn,
            objFees: {
                nFeeContractInvocation,
                nFeeSize: nFeeSizeFakeTx,
                nFeeStorage
            }
        });
    });

    it('should create instance', async () => {
        new factory.Application();
    });

    it('should processTxInputs', async () => {
        const app = new factory.Application();

        const utxoHash = pseudoRandomBuffer().toString('hex');
        const {storage, keyPair} = await createGenesis(factory, utxoHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(utxoHash, 12);
        tx.addInput(utxoHash, 0);
        tx.addInput(utxoHash, 80);
        tx.addReceiver(1000, buffAddress);
        tx.claim(0, keyPair.privateKey);
        tx.claim(1, keyPair.privateKey);
        tx.claim(2, keyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const patch = await storage.getUtxosPatch(tx.utxos);

        await app.processTxInputs(tx, patch);
    });

    it('should processPayments', async () => {
        const app = new factory.Application();

        const utxoHash = pseudoRandomBuffer().toString('hex');
        const {storage, keyPair} = await createGenesis(factory, utxoHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(utxoHash, 12);
        tx.addInput(utxoHash, 0);
        tx.addInput(utxoHash, 80);
        tx.addReceiver(1000, buffAddress);
        tx.claim(0, keyPair.privateKey);
        tx.claim(1, keyPair.privateKey);
        tx.claim(2, keyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const patchUtxos = await storage.getUtxosPatch(tx.utxos);
        const {patch} = app.processTxInputs(tx, patchUtxos);

        app.processPayments(tx, patch);
    });

    it('should throw (wrong UTXO index -> no coins)', async () => {
        const app = new factory.Application();

        const utxoHash = pseudoRandomBuffer().toString('hex');
        const {storage, keyPair} = await createGenesis(factory, utxoHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(utxoHash, 17);
        tx.addReceiver(1000, buffAddress);
        tx.claim(0, keyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const patchUtxos = await storage.getUtxosPatch(tx.utxos);

        try {
            app.processTxInputs(tx, patchUtxos);
        } catch (e) {
            debug(e);
            assert.equal(e.message, `Output #17 of Tx ${utxoHash} already spent!`);
            return;
        }
        throw new Error('Unexpected success');
    });

    it('should throw (bad claim)', async () => {
        const app = new factory.Application();

        const utxoHash = pseudoRandomBuffer().toString('hex');
        const {storage, keyPair} = await createGenesis(factory, utxoHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);
        const anotherKeyPair = factory.Crypto.createKeyPair();

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(utxoHash, 12);
        tx.addReceiver(100000, buffAddress);
        tx.claim(0, anotherKeyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const patchUtxos = await storage.getUtxosPatch(tx.utxos);

        try {
            app.processTxInputs(tx, patchUtxos);
        } catch (e) {
            debug(e);
            assert.equal(e.message, 'Claim failed!');
            return;
        }
        throw new Error('Unexpected success');
    });

    it('should process TX from GENESIS block', async () => {
        const app = new factory.Application();

        const utxoHash = pseudoRandomBuffer().toString('hex');
        const {storage, keyPair} = await createGenesis(factory, utxoHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);
        const anotherKeyPair = factory.Crypto.createKeyPair();

        // create tx
        const tx = new factory.Transaction();
        tx.addReceiver(100000, buffAddress);
        tx.claim(0, anotherKeyPair.privateKey);

        const patch = new factory.PatchDB(0);

        app.processPayments(tx, patch);

        assert.equal(patch.getCoins().size, 1);
        const utxo = patch.getUtxo(tx.hash());
        assert.isOk(utxo);
        assert.isNotOk(utxo.isEmpty());
    });

    it('should NOT process TX (bad 2nd input)', async () => {
        const app = new factory.Application();

        const utxoHash = pseudoRandomBuffer().toString('hex');
        const {storage, keyPair} = await createGenesis(factory, utxoHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(utxoHash, 12);
        tx.addInput(utxoHash, 12);
        tx.addReceiver(1000, buffAddress);
        tx.claim(0, keyPair.privateKey);
        tx.claim(1, keyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const patchUtxos = await storage.getUtxosPatch([utxoHash]);

        try {
            app.processTxInputs(tx, patchUtxos);
        } catch (e) {
            debug(e);
            assert.equal(e.message, `Tx ${utxoHash} index 12 already deleted!`);
            return;
        }
        throw new Error('Unexpected success');
    });

    it('should NOT process 2nd TX (simulate block exec)', async () => {
        const app = new factory.Application();

        const utxoHash = pseudoRandomBuffer().toString('hex');
        const {storage, keyPair} = await createGenesis(factory, utxoHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(utxoHash, 12);
        tx.addReceiver(1000, buffAddress);
        tx.claim(0, keyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const patchUtxos = await storage.getUtxosPatch(tx.utxos);
        const {patch} = app.processTxInputs(tx, patchUtxos);
        app.processPayments(tx, patch);

        // create tx
        const keyPair2 = factory.Crypto.createKeyPair();
        const buffAddress2 = factory.Crypto.getAddress(keyPair2.publicKey, true);
        const tx2 = new factory.Transaction();
        tx2.addInput(utxoHash, 12);
        tx2.addReceiver(1000, buffAddress2);
        tx2.claim(0, keyPair.privateKey);

        const patchUtxos2 = await storage.getUtxosPatch(tx2.utxos);

        try {
            const patchMerged = patch.merge(patchUtxos2);
            app.processTxInputs(tx2, patchMerged);
        } catch (e) {
            debug(e);
            assert.equal(e.message, `Output #12 of Tx ${utxoHash} already spent!`);
            return;
        }
        throw new Error('Unexpected success');
    });

    it('should parse contract code', async () => {
        const strCode = `
            class A extends Base {
                constructor(...arrValues){
                    super();
                    this._data=arrValues[0];
                }
            
                changeDefinition(objNewDefinition){
                }
            
                addDefinition
                (objConcilium)
                {
            
                    // check fee!
                    console.log(objConcilium)
                }
            
                noArguments(){}
            
                _validateDefinition(objConcilium) {
                }
                
                // getters/setters ignored
                set data(value){
                    return this._data=value;
                }
            
                get data(){
                    return this._data;
                }
            }
            exports=new A(10);
            `;
        const callerAddress = generateAddress().toString('hex');

        const contract = app.createContract(
            strCode,
            {contractAddr: 'hash', callerAddress}
        );

        assert.isOk(contract);
        assert.deepEqual(contract.getData(), {_data: 10, _ownerAddress: callerAddress});

        const objCode = contract.getCode();
        assert.isOk(objCode);
        assert.isOk(arrayEquals(Object.keys(objCode),
            [
                'changeDefinition', 'addDefinition', 'noArguments', '_validateDefinition', '_checkOwner',
                '_transferOwnership', '_validateAddress']
        ));
    });

    it('should prepare code for exec (just shouldn\'t throw)', async () => {
        const contract = new factory.Contract({
            contractCode: {changeDefinition: "(objNewDefinition){}"},
            contractData: {_data: 19}
        });

        const app = new factory.Application();
        app._prepareCode(contract.getCode());
    });

    it('should run contract', async () => {
        const conciliumId = 10;
        const contract = new factory.Contract({
            contractData: {value: 200100},
            contractCode: '{"add": "(a){this.value+=a;}"}',
            conciliumId
        });

        await app.runContract(
            {method: 'add', arrArguments: [10]},
            contract,
            {}, undefined
        );

        assert.equal(app.coinsSpent(), nFeeContractInvocation);
        assert.deepEqual(contract.getData(), {value: 200110});
    });

    it('should throw (unknown method)', async () => {
        const conciliumId = 10;
        const contract = new factory.Contract({
            contractData: {value: 100},
            contractCode: '{"add": "(a){this.value+=a;}"}',
            conciliumId
        });

        return assert.isRejected(app.runContract(
            {method: 'subtract', arrArguments: [10]},
            contract,
            {}, undefined
        ), /Method .+ not found/);
    });

    it('should throw (no default function)', async () => {
        const conciliumId = 10;
        const contract = new factory.Contract({
            contractData: {value: 100},
            contractCode: '{"add": "(a){this.value+=a;}"}',
            conciliumId
        });

        return assert.isRejected(app.runContract(
            {},
            contract,
            {}, undefined
        ), /Method _default not found/);
    });

    it('should call default function', async () => {
        const conciliumId = 10;
        const contract = new factory.Contract({
            contractData: {value: 100},
            contractCode: '{"_default": "(){this.value+=17;}"}',
            conciliumId
        });
        const app = new factory.Application();

        app.setupVariables({
            coinsLimit: Number.MAX_SAFE_INTEGER,
            objFees: {nFeeContractInvocation: 1e4, nFeeStorage: 10}
        });

        await app.runContract(
            {}, contract,
            {}, undefined, false
        );

        assert.deepEqual(contract.getData(), {value: 117});
    });

    it('should call "constant function"', async () => {
        const conciliumId = 10;
        const sampleResult = {a: 10, b: 20};
        const contract = new factory.Contract({
            contractData: {sampleResult},
            contractCode: `{"test": "() {return this.sampleResult;}"}`,
            conciliumId
        });

        const app = new factory.Application();

        app.setupVariables({
            coinsLimit: Number.MAX_SAFE_INTEGER,
            objFees: {nFeeContractInvocation: 1e4, nFeeStorage: 10}
        });

        const result = await app.runContract(
            {method: 'test', arrArguments: []},
            contract,
            {},
            undefined,
            true
        );

        assert.isOk(result);
        assert.deepEqual(result, sampleResult);
    });

    it('should process TX with single claim in txSignature', async () => {
        const app = new factory.Application();

        const utxoHash = pseudoRandomBuffer().toString('hex');
        const {storage, keyPair} = await createGenesis(factory, utxoHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(utxoHash, 12);
        tx.addInput(utxoHash, 0);
        tx.addInput(utxoHash, 80);
        tx.addReceiver(1000, buffAddress);
        tx.signAllInputs(keyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const patchUtxos = await storage.getUtxosPatch(tx.utxos);
        const {patch} = app.processTxInputs(tx, patchUtxos);

        app.processPayments(tx, patch);
    });

    describe('Injected functions', async ()=>{
        it('should run sha3', async () => {
            const conciliumId = 10;
            const msg='test';

            const contract = new factory.Contract({
                contractData: {},
                contractCode: '{"test": "(strMsg){return sha3(strMsg);}"}',
                conciliumId
            });

            const result = await app.runContract(
                {method: 'test', arrArguments: [msg]},
                contract,
                {}, undefined,
                true
            );

            assert.equal(result, factory.Crypto.sha3(msg));
        });
    });
});
