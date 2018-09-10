'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const {createDummyTx} = require('./testUtil');

const factory = require('./testFactory');

let keyPair;

describe('Mempool tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
        keyPair = factory.Crypto.createKeyPair();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create mempool', async () => {
        const wrapper = () => new factory.Mempool();
        assert.doesNotThrow(wrapper);
    });

    it('should add tx to mempool', async () => {
        const mempool = new factory.Mempool();
        const tx = new factory.Transaction(createDummyTx());
        tx.sign(0, keyPair.privateKey);

        mempool.addTxUnchecked(tx);
        assert.isOk(mempool.hasTx(tx));
    });

    it('should FAIL add tx to mempool (already exists)', async () => {
        const mempool = new factory.Mempool();
        const tx = new factory.Transaction(createDummyTx());
        tx.sign(0, keyPair.privateKey);

        const wrapper = () => mempool.addTxUnchecked(tx);
        assert.doesNotThrow(wrapper);
        assert.throws(wrapper);
    });

    it('should FAIL add tx to mempool (invalid tx: not signed)', async () => {
        const mempool = new factory.Mempool();
        const tx = new factory.Transaction(createDummyTx());

        const wrapper = () => mempool.validateAddTx(tx);
        assert.throws(wrapper);
    });

    it('should FAIL add tx to mempool (DOUBLE SPEND)', async () => {
        const mempool = new factory.Mempool();
        const tx = new factory.Transaction(createDummyTx());

        const wrapper = () => mempool.addTxUnchecked(tx);
        assert.doesNotThrow(wrapper);

        const [utxo] = tx.coins;
        const doubleSpend = new factory.Transaction(createDummyTx(utxo));
        const wrapperDs = () => mempool.addTxUnchecked(doubleSpend);
        assert.throws(wrapperDs);
    });

    it('should add 2 different tx', async () => {
        const mempool = new factory.Mempool();
        const tx1 = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());

        mempool.addTxUnchecked(tx1);
        mempool.addTxUnchecked(tx2);

        assert.isOk(mempool.hasTx(tx1));
        assert.isOk(mempool.hasTx(tx2));
    });

    it('should remove txns from mempool with new block', async () => {
        const mempool = new factory.Mempool();
        const tx1 = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());

        mempool.addTxUnchecked(tx1);
        mempool.addTxUnchecked(tx2);

        const block = new factory.Block();
        block.addTx(tx1);
        block.addTx(tx2);

        mempool.removeForBlock(block);

        assert.isNotOk(mempool.hasTx(tx1));
        assert.isNotOk(mempool.hasTx(tx2));
    });

});
