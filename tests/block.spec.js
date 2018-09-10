'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const debug = require('debug')('block:');

const factory = require('./testFactory');

const createDummyTx = () => ({
    payload: {
        ins: [{txHash: Buffer.allocUnsafe(32), nTxOutput: parseInt(Math.random() * 1000)}],
        outs: [{amount: parseInt(Math.random() * 1000)}]
    },
    claimProofs: [Buffer.allocUnsafe(32)]
});

describe('Block tests', () => {
    before(async function() {
        await factory.asyncLoad();
    });

    it('should create block', async () => {
        const wrapper = () => new factory.Block();
        assert.doesNotThrow(wrapper);
    });

    it('should add tx', async () => {
        const block = new factory.Block();
        const tx = new factory.Transaction(createDummyTx());

        block.addTx(tx);
        assert.isOk(Array.isArray(block.txns));
        assert.equal(block.txns.length, 1);
    });

    it('should calc hash', async () => {
        const block = new factory.Block();
        const keyPair = factory.Crypto.createKeyPair();
        const tx = new factory.Transaction(createDummyTx());
        tx.sign(0, keyPair.privateKey);

        block.addTx(tx);
        debug(block.hash);
        assert.isOk(block.hash);
        assert.equal(block.hash, block.hash);

        const anotherBlock = new factory.Block();
        const anotherTx = new factory.Transaction(createDummyTx());
        anotherTx.sign(0, keyPair.privateKey);
        anotherBlock.addTx(anotherTx);
        debug(anotherBlock.hash);
        assert.notEqual(block.hash, anotherBlock.hash);
    });

    it('should encode/decode', async () => {
        const block = new factory.Block();
        const keyPair = factory.Crypto.createKeyPair();
        const tx = new factory.Transaction(createDummyTx());
        tx.sign(0, keyPair.privateKey);

        block.addTx(tx);
        const buffBlock = block.encode();
        assert.isOk(Buffer.isBuffer(buffBlock));

        const restoredBlock = new factory.Block(buffBlock);
        assert.equal(block.hash, restoredBlock.hash);
        assert.isOk(Array.isArray(restoredBlock.txns));
        assert.equal(restoredBlock.txns.length, 1);

        const restoredTx = new factory.Transaction(restoredBlock.txns[0]);
        assert.isOk(restoredTx.equals(tx));
    });

});
