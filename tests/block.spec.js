'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const debug = require('debug')('block:');

const factory = require('./testFactory');

const txPayload = {
    nonce: 20,
    gasLimit: 102,
    gasPrice: 21,
    to: '43543543525454',
    value: 1200,
    extField: 'extFieldextFieldextField'
};

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
        const tx = new factory.Transaction({payload: txPayload});

        block.addTx(tx);
        assert.isOk(Array.isArray(block.txns));
        assert.equal(block.txns.length, 1);
    });

    it('should calc hash', async () => {
        const block = new factory.Block();
        const keyPair = factory.Crypto.createKeyPair();
        const tx = new factory.Transaction({payload: txPayload});
        tx.sign(keyPair.privateKey);

        block.addTx(tx);
        debug(block.hash);
        assert.isOk(block.hash);
        assert.equal(block.txns.length, 1);
    });

    it('should encode/decode', async () => {
        const block = new factory.Block();
        const keyPair = factory.Crypto.createKeyPair();
        const tx = new factory.Transaction({payload: txPayload});
        tx.sign(keyPair.privateKey);

        block.addTx(tx);
        const buffBlock = block.encode();
        assert.isOk(Buffer.isBuffer(buffBlock));

        const restoredBlock = new factory.Block(buffBlock);
        assert.equal(block.hash, restoredBlock.hash);
        assert.isOk(Array.isArray(block.txns));
        assert.equal(block.txns.length, 1);
        assert.deepEqual(block.txns[0], tx.rawData);
    });

});
