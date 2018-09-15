'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();
const debug = require('debug')('application:test');

const factory = require('./testFactory');
const {createDummyTx, pseudoRandomBuffer} = require('./testUtil');

const createGenezis = (txHash) => {
    const patch = new factory.PatchDB();
    const keyPair = factory.Crypto.createKeyPair();
    const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

    // create "genezis"
    const coins = new factory.Coins(100000, buffAddress);
    patch.createCoins(txHash, 12, coins);
    patch.createCoins(txHash, 0, coins);
    patch.createCoins(txHash, 80, coins);

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

    it('should process TX', async () => {
        const app = new factory.Application();

        const txHash = pseudoRandomBuffer().toString('hex');
        const {storage, keyPair} = createGenezis(txHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(txHash, 12);
        tx.addInput(txHash, 0);
        tx.addInput(txHash, 80);
        tx.addReceiver(1000, buffAddress);
        tx.sign(0, keyPair.privateKey);
        tx.sign(1, keyPair.privateKey);
        tx.sign(2, keyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const utxo = await storage.getUtxo(txHash);
        const objUtxos = {[txHash]: utxo};

        await app.processTx(tx, objUtxos);

    });

    it('should throw (wrong UTXO index -> no coins)', async () => {
        const app = new factory.Application();

        const txHash = pseudoRandomBuffer().toString('hex');
        const {storage, keyPair} = createGenezis(txHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(txHash, 17);
        tx.addReceiver(1000, buffAddress);
        tx.sign(0, keyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const utxo = await storage.getUtxo(txHash);
        const objUtxos = {[txHash]: utxo};

        try {
            await app.processTx(tx, objUtxos);
        } catch (e) {
            debug(e);
            assert.equal(e.message, `Output #17 of Tx ${txHash} already spent!`);
            return;
        }
        throw new Error('Unexpected success');
    });

    it('should throw (not enough moneys)', async () => {
        const app = new factory.Application();

        const txHash = pseudoRandomBuffer().toString('hex');
        const {storage, keyPair} = createGenezis(txHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(txHash, 12);
        tx.addReceiver(100000, buffAddress);
        tx.sign(0, keyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const utxo = await storage.getUtxo(txHash);
        const objUtxos = {[txHash]: utxo};

        try {
            await app.processTx(tx, objUtxos);
        } catch (e) {
            debug(e);
            assert.equal(e.message, `Tx ${tx.hash()} fee 0 too small!`);
            return;
        }
        throw new Error('Unexpected success');
    });

    it('should throw (bad claim)', async () => {
        const app = new factory.Application();

        const txHash = pseudoRandomBuffer().toString('hex');
        const {storage, keyPair} = createGenezis(txHash);
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);
        const anotherKeyPair = factory.Crypto.createKeyPair();

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(txHash, 12);
        tx.addReceiver(100000, buffAddress);
        tx.sign(0, anotherKeyPair.privateKey);

        // get utxos from storage, and form object for app.processTx
        const utxo = await storage.getUtxo(txHash);
        const objUtxos = {[txHash]: utxo};

        try {
            await app.processTx(tx, objUtxos);
        } catch (e) {
            debug(e);
            assert.equal(e.message, 'Claim failed!');
            return;
        }
        throw new Error('Unexpected success');
    });

});
