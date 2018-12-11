'use strict';

const v8 = require('v8');
const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();
const debug = require('debug')('application:test');

const factory = require('./testFactory');
const {pseudoRandomBuffer} = require('./testUtil');

const createGenezis = (factory, utxoHash) => {
    const patch = new factory.PatchDB(0);
    const keyPair = factory.Crypto.createKeyPair();
    const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

    // create "genezis"
    const coins = new factory.Coins(100000, buffAddress);
    patch.createCoins(utxoHash, 12, coins);
    patch.createCoins(utxoHash, 0, coins);
    patch.createCoins(utxoHash, 80, coins);

    const storage = new factory.Storage({});
    storage.applyPatch(patch);

    return {storage, keyPair};
};

describe('Application layer', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create instance', async () => {
        new factory.Application();
    });

    it('should processTxInputs', async () => {
        const app = new factory.Application();

        const utxoHash = pseudoRandomBuffer().toString('hex');
        const {storage, keyPair} = createGenezis(factory, utxoHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(utxoHash, 12);
        tx.addInput(utxoHash, 0);
        tx.addInput(utxoHash, 80);
        tx.addReceiver(1000, buffAddress);
        tx.sign(0, keyPair.privateKey);
        tx.sign(1, keyPair.privateKey);
        tx.sign(2, keyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const mapUtxos = await storage.getUtxosCreateMap(tx.utxos);

        await app.processTxInputs(tx, mapUtxos);

    });

    it('should process TX', async () => {
        const app = new factory.Application();

        const utxoHash = pseudoRandomBuffer().toString('hex');
        const {storage, keyPair} = createGenezis(factory, utxoHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(utxoHash, 12);
        tx.addInput(utxoHash, 0);
        tx.addInput(utxoHash, 80);
        tx.addReceiver(1000, buffAddress);
        tx.sign(0, keyPair.privateKey);
        tx.sign(1, keyPair.privateKey);
        tx.sign(2, keyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const mapUtxos = await storage.getUtxosCreateMap(tx.utxos);

        const {patch} = app.processTxInputs(tx, mapUtxos);
        app.processPayments(tx, patch);
    });

    it('should throw (wrong UTXO index -> no coins)', async () => {
        const app = new factory.Application();

        const utxoHash = pseudoRandomBuffer().toString('hex');
        const {storage, keyPair} = createGenezis(factory, utxoHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(utxoHash, 17);
        tx.addReceiver(1000, buffAddress);
        tx.sign(0, keyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const mapUtxos = await storage.getUtxosCreateMap(tx.utxos);

        try {
            app.processTxInputs(tx, mapUtxos);
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
        const {storage, keyPair} = createGenezis(factory, utxoHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);
        const anotherKeyPair = factory.Crypto.createKeyPair();

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(utxoHash, 12);
        tx.addReceiver(100000, buffAddress);
        tx.sign(0, anotherKeyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const mapUtxos = await storage.getUtxosCreateMap(tx.utxos);

        try {
            app.processTxInputs(tx, mapUtxos);
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
        const {storage, keyPair} = createGenezis(factory, utxoHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);
        const anotherKeyPair = factory.Crypto.createKeyPair();

        // create tx
        const tx = new factory.Transaction();
        tx.addReceiver(100000, buffAddress);
        tx.sign(0, anotherKeyPair.privateKey);

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
        const {storage, keyPair} = createGenezis(factory, utxoHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(utxoHash, 12);
        tx.addInput(utxoHash, 12);
        tx.addReceiver(1000, buffAddress);
        tx.sign(0, keyPair.privateKey);
        tx.sign(1, keyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const utxo = await storage.getUtxo(utxoHash);
        const mapUtxos = {[utxoHash]: utxo};

        try {
            app.processTxInputs(tx, mapUtxos);
        } catch (e) {
            debug(e);
            assert.equal(e.message, `Output #12 of Tx ${utxoHash} already spent!`);
            return;
        }
        throw new Error('Unexpected success');
    });

    it('should NOT process 2nd TX (simulate block exec)', async () => {
        const app = new factory.Application();

        const utxoHash = pseudoRandomBuffer().toString('hex');
        const {storage, keyPair} = createGenezis(factory, utxoHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(utxoHash, 12);
        tx.addReceiver(1000, buffAddress);
        tx.sign(0, keyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const mapUtxos = await storage.getUtxosCreateMap(tx.utxos);
        const {patch} = app.processTxInputs(tx, mapUtxos);
        app.processPayments(tx, patch);

        // create tx
        const keyPair2 = factory.Crypto.createKeyPair();
        const buffAddress2 = factory.Crypto.getAddress(keyPair2.publicKey, true);
        const tx2 = new factory.Transaction();
        tx2.addInput(utxoHash, 12);
        tx2.addReceiver(1000, buffAddress2);
        tx2.sign(0, keyPair.privateKey);

        const mapUtxos2 = await storage.getUtxosCreateMap(tx2.utxos);

        try {
            app.processTxInputs(tx2, mapUtxos2, patch);
        } catch (e) {
            debug(e);
            assert.equal(e.message, `Output #12 of Tx ${utxoHash} already spent!`);
            return;
        }
        throw new Error('Unexpected success');
    });

    it('should create contract', async () => {
        const app = new factory.Application();
        const strGetDataCode = `getData(){
                return this._data;
            }`;
        const strCode = `
            class A extends Base{
                constructor(param){
                    super();
                    this._data=param;
                }
                
                ${strGetDataCode}
                
                set data(value){
                    return this._data=value;
                }
                
                get data(){
                    return this._data;
                }
            };
            
            new A(10);
            `;
        const patch = new factory.PatchDB(0);
        const tx = factory.Transaction.createContract(strCode, 100000);
        patch.setContract = sinon.fake();
        app.createContract(tx, patch);

        assert.isOk(patch.setContract.called);

        const [, objData, strCodeExportedFunctions] = patch.setContract.args[0];

        assert.deepEqual(objData, {_data: 10});
        assert.equal(strCodeExportedFunctions, strGetDataCode);
    });
});
