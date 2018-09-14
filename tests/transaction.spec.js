'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const {createDummyTx, pseudoRandomBuffer} = require('./testUtil');

let keyPair;
let privateKey;
let publicKey;

const factory = require('./testFactory');

describe('Transaction tests', () => {
    before(async function() {
        await factory.asyncLoad();
        keyPair = factory.Crypto.createKeyPair();
        privateKey = keyPair.getPrivate();
        publicKey = keyPair.getPublic();
    });

    it('should create empty transaction', async () => {
        const wrapper = () => new factory.Transaction();
        assert.doesNotThrow(wrapper);
    });

    it('should FAIL due oversized transaction', async () => {
        const wrapper = () => new factory.Transaction(Buffer.allocUnsafe(factory.Constants.MAX_BLOCK_SIZE + 1));
        assert.throws(wrapper);
    });

    it('should create transaction from Object', async () => {
        const wrapper = () => new factory.Transaction(createDummyTx());
        assert.doesNotThrow(wrapper);
    });

    it('should calculate hash', async () => {
        const tx = new factory.Transaction(createDummyTx());
        const hash = tx.hash();
        assert.isOk(typeof hash === 'string');
        assert.equal(hash.length, 64);
    });

    it('should FAIL to parse random bytes', async () => {
        const wrapper = () => new factory.Transaction(Buffer.allocUnsafe(100));
        assert.throws(wrapper);
    });

    it('should add input', async () => {
        const tx = new factory.Transaction();
        tx.addInput(pseudoRandomBuffer(), 1);
        assert.isOk(tx._data.payload.ins);
        assert.equal(tx._data.payload.ins.length, 1);
    });

    it('should add output (receiver)', async () => {
        const tx = new factory.Transaction();
        tx.addReceiver(100, Buffer.allocUnsafe(20));
        assert.isOk(tx._data.payload.outs);
        assert.equal(tx._data.payload.outs.length, 1);
    });

    it('should change hash upon changes', async () => {
        const tx = new factory.Transaction();
        const hash = tx.hash();

        tx.addInput(pseudoRandomBuffer(), 1);
        const inHash = tx.hash();
        assert.notEqual(hash, inHash);

        tx.addReceiver(100, Buffer.allocUnsafe(20));
        assert.notEqual(inHash, tx.hash());
    });

    it('should sign it', async () => {
        const tx = new factory.Transaction();
        tx.addInput(pseudoRandomBuffer(), 1);
        tx.addReceiver(100, Buffer.allocUnsafe(20));
        tx.sign(0, keyPair.privateKey);
        assert.isOk(Array.isArray(tx._data.claimProofs));
        assert.equal(tx._data.claimProofs.length, 1);
        assert.isOk(Buffer.isBuffer(tx._data.claimProofs[0]));

        assert.isOk(factory.Crypto.verify(tx.hash(), tx._data.claimProofs[0], keyPair.publicKey));
    });

    it('should FAIL to sign (missed PK) ', async () => {
        const tx = new factory.Transaction();
        tx.addInput(pseudoRandomBuffer(), 1);
        tx.addReceiver(100, Buffer.allocUnsafe(20));
        const wrapper = () => tx.sign(0);
        assert.throws(wrapper);
    });

    it('should FAIL to sign (wrong index) ', async () => {
        const tx = new factory.Transaction();
        tx.addInput(pseudoRandomBuffer(), 1);
        tx.addReceiver(100, Buffer.allocUnsafe(20));
        const wrapper = () => tx.sign(2, keyPair.privateKey);
        assert.throws(wrapper);
    });

    it('should FAIL to modify after signing it', async () => {
        const tx = new factory.Transaction();
        tx.addInput(pseudoRandomBuffer(), 1);
        tx.sign(0, keyPair.privateKey);
        const wrapper = () => tx.addInput(pseudoRandomBuffer(), 1);
        assert.throws(wrapper);
    });

    it('should encode/decode', async () => {
        const tx = new factory.Transaction();
        tx.addInput(pseudoRandomBuffer(), 15);
        tx.addReceiver(1117, Buffer.allocUnsafe(20));
        tx.sign(0, keyPair.privateKey);

        const buffEncoded = tx.encode();

        const recoveredTx = new factory.Transaction(buffEncoded);
        assert.isOk(recoveredTx.equals(tx));
    });

    it('should change hash upon modification', async () => {
        const tx = new factory.Transaction();
        tx.addInput(pseudoRandomBuffer(), 15);
        tx.addReceiver(1117, Buffer.allocUnsafe(20));
        const hash = tx.hash();

        tx._data.payload.ins[0].nTxOutput = 1;
        assert.notEqual(hash, tx.hash());
    });

    it('should fail signature check upon modification', async () => {
        const tx = new factory.Transaction();
        tx.addInput(pseudoRandomBuffer(), 15);
        tx.addReceiver(1117, Buffer.allocUnsafe(20));
        tx.sign(0, keyPair.privateKey);

        tx._data.payload.ins[0].nTxOutput = 1;

        assert.isNotOk(factory.Crypto.verify(tx.hash(), tx._data.claimProofs[0], keyPair.publicKey));
    });

    it('should fail to verify: no claimProof for input0', async () => {
        const tx = new factory.Transaction();
        tx.addInput(pseudoRandomBuffer(), 15);

        assert.isNotOk(tx.verify());
    });

    it('should fail to verify: zero tx', async () => {
        const tx = new factory.Transaction();
        tx.addInput(Buffer.alloc(32), 15);

        assert.isNotOk(tx.verify());
    });

    it('should fail to verify: negative tx index', async () => {
        const tx = new factory.Transaction();
        tx.addInput(pseudoRandomBuffer(), -1);

        assert.isNotOk(tx.verify());
    });

    it('should fail to verify: zero amount', async () => {
        const tx = new factory.Transaction();
        tx.addReceiver(0, Buffer.allocUnsafe(20));

        assert.isNotOk(tx.verify());
    });

    it('should verify', async () => {
        const tx = new factory.Transaction();
        tx.addInput(pseudoRandomBuffer(), 0);
        tx.addReceiver(1, Buffer.allocUnsafe(20));
        tx.sign(0, keyPair.privateKey);

        assert.isOk(tx.verify());
    });

    it('should fail to create tx: verification failed during decoding from buffer', async () => {
        const tx = new factory.Transaction();
        tx.addInput(pseudoRandomBuffer(), 15);

        const buffEncodedTx = tx.encode();
        const wrapper = () => new factory.Transaction(buffEncodedTx);
        assert.throws(wrapper);
    });

    it('should fail to create tx: verification failed during creating from Object', async () => {
        const tx = new factory.Transaction();
        tx.addInput(pseudoRandomBuffer(), 17);

        const wrapper = () => new factory.Transaction(tx.rawData);
        assert.throws(wrapper);
    });

    it('should get utxos from tx', async () => {
        const tx = new factory.Transaction();
        const utxo = pseudoRandomBuffer();
        tx.addInput(utxo, 15);

        assert.isOk(Array.isArray(tx.coins));
        assert.isOk(utxo.equals(tx.coins[0]));
    });

});
