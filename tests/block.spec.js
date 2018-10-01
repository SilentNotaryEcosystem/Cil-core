'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const debug = require('debug')('block:test');

const factory = require('./testFactory');
const {createDummyTx} = require('./testUtil');

describe('Block tests', () => {
    before(async function() {
        await factory.asyncLoad();
    });

    it('should create block', async () => {
        const wrapper = () => new factory.Block(0);
        assert.doesNotThrow(wrapper);
    });

    it('should add tx', async () => {
        const block = new factory.Block(0);
        const tx = new factory.Transaction(createDummyTx());

        block.addTx(tx);
        assert.isOk(Array.isArray(block.txns));
        assert.equal(block.txns.length, 1);
    });

    it('should create block for specified group', async () => {
        const block = new factory.Block(3);
        assert.equal(block.witnessGroupId, 3);
    });

    it('should calc hash', async () => {
        const block = new factory.Block(0);
        const keyPair = factory.Crypto.createKeyPair();
        const tx = new factory.Transaction(createDummyTx());
        tx.sign(0, keyPair.privateKey);

        block.addTx(tx);
        block.finish(factory.Constants.MIN_TX_FEE, keyPair.publicKey);

        const hash = block.hash();
        debug(block.hash());

        assert.isOk(typeof hash === 'string');
        assert.equal(hash.length, 64);

        // next hash call - return same value
        assert.equal(hash, block.hash());

        const anotherBlock = new factory.Block(0);
        const anotherTx = new factory.Transaction(createDummyTx());
        anotherTx.sign(0, keyPair.privateKey);
        anotherBlock.addTx(anotherTx);
        anotherBlock.finish(factory.Constants.MIN_TX_FEE, keyPair.publicKey);

        debug(anotherBlock.hash());
        assert.notEqual(block.hash(), anotherBlock.hash());
    });

    it('should encode/decode', async () => {
        const block = new factory.Block(0);
        const keyPair = factory.Crypto.createKeyPair();
        const tx = new factory.Transaction(createDummyTx());
        tx.sign(0, keyPair.privateKey);

        block.addTx(tx);
        block.finish(factory.Constants.MIN_TX_FEE, keyPair.publicKey);

        const buffBlock = block.encode();
        assert.isOk(Buffer.isBuffer(buffBlock));

        const restoredBlock = new factory.Block(buffBlock);
        assert.equal(block.hash(), restoredBlock.hash());
        assert.isOk(Array.isArray(restoredBlock.txns));
        assert.equal(restoredBlock.txns.length, 2);

        const coinbase = new factory.Transaction(restoredBlock.txns[0]);
        assert.isOk(coinbase.isCoinbase());
        const restoredTx = new factory.Transaction(restoredBlock.txns[1]);
        assert.isOk(restoredTx.equals(tx));
    });

});
