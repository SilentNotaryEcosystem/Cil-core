'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const {sleep, createDummyTx} = require('./testUtil');
const {arrayEquals} = require('../utils');
const sinon = require('sinon').createSandbox();

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

    afterEach(async () => {
        sinon.restore();
    });

    it('should create mempool', async () => {
        const wrapper = () => new factory.Mempool();
        assert.doesNotThrow(wrapper);
    });

    it('should add tx to mempool', async () => {
        const mempool = new factory.Mempool();
        const tx = new factory.Transaction(createDummyTx());
        tx.claim(0, keyPair.privateKey);

        mempool.addTx(tx);
        assert.isOk(mempool.hasTx(tx.hash()));
    });

    it('should FAIL add tx to mempool (already exists)', async () => {
        const mempool = new factory.Mempool();
        const tx = new factory.Transaction(createDummyTx());
        tx.claim(0, keyPair.privateKey);

        const wrapper = () => mempool.addTx(tx);
        assert.doesNotThrow(wrapper);
        assert.throws(wrapper);
    });

    it('should FAIL add tx to mempool (invalid tx: not signed)', async () => {
        const mempool = new factory.Mempool();
        const tx = new factory.Transaction(createDummyTx());

        const wrapper = () => mempool.validateAddTx(tx);
        assert.throws(wrapper);
    });

    it('should add 2 different tx', async () => {
        const mempool = new factory.Mempool();
        const tx1 = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());

        mempool.addTx(tx1);
        mempool.addTx(tx2);

        // hash is String
        assert.isOk(mempool.hasTx(tx1.hash()));

        // hash is Buffer
        assert.isOk(mempool.hasTx(Buffer.from(tx2.hash(), 'hex')));
    });

    it('should remove txns from mempool with new block', async () => {
        const mempool = new factory.Mempool();
        const tx1 = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());

        mempool.addTx(tx1);
        mempool.addTx(tx2);

        const block = new factory.Block(0);
        block.addTx(tx1);
        block.addTx(tx2);

        mempool.removeForBlock(block.getTxHashes());

        assert.isNotOk(mempool.hasTx(tx1.hash()));
        assert.isNotOk(mempool.hasTx(tx2.hash()));
    });

    it('should get tx by hash', async () => {
        const mempool = new factory.Mempool();
        const tx1 = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());

        mempool.addTx(tx1);
        mempool.addTx(tx2);

        const gotTx = mempool.getTx(tx1.hash());
        assert.isOk(gotTx.equals(tx1));
    });

    it('should get TXns with specific witnessGroupId', async () => {
        const mempool = new factory.Mempool();
        const tx1 = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());
        const tx3 = new factory.Transaction();
        tx3.rawData.payload.witnessGroupId = 2;

        mempool.addTx(tx1);
        mempool.addTx(tx2);
        mempool.addTx(tx3);

        const arrTxns = mempool.getFinalTxns(0);
        assert.isOk(Array.isArray(arrTxns));
        assert.equal(arrTxns.length, 2);
    });

    it('should remove oldest txns with age > TX_LIFETIME(5s.)', async function() {
        const mempool = new factory.Mempool();
        const tx1 = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());
        const tx3 = new factory.Transaction(createDummyTx());
        mempool.addTx(tx1);
        mempool.addTx(tx2);
        const future = Date.now() + factory.Constants.MEMPOOL_TX_LIFETIME + 1;
        sinon.stub(Date, 'now').callsFake(_ => future);
        mempool.addTx(tx3);

        mempool.purgeOutdated();

        assert.isNotOk(mempool.hasTx(tx1.hash()));
        assert.isNotOk(mempool.hasTx(tx2.hash()));
        assert.isOk(mempool.hasTx(tx3.hash()));
    });

    it('should not remove  txns if tx age <= 5s. ', async () => {
        const mempool = new factory.Mempool();
        const tx1 = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());
        mempool.addTx(tx1);
        mempool.addTx(tx2);

        mempool.purgeOutdated();

        assert.isOk(mempool.hasTx(tx1.hash()));
        assert.isOk(mempool.hasTx(tx2.hash()));
    });

    it('should remove oldest txns if tx qty > MEMPOOL_TX_QTY(5)', async () => {
        const mempool = new factory.Mempool();
        const tx1 = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());
        const tx3 = new factory.Transaction(createDummyTx());
        const tx4 = new factory.Transaction(createDummyTx());
        const tx5 = new factory.Transaction(createDummyTx());
        const tx6 = new factory.Transaction(createDummyTx());

        mempool.addTx(tx1);
        mempool.addTx(tx2);
        mempool.addTx(tx3);
        mempool.addTx(tx4);
        mempool.addTx(tx5);
        mempool.addTx(tx6);

        assert.isNotOk(mempool.hasTx(tx1.hash()));
        assert.isOk(mempool.hasTx(tx2.hash()));
        assert.isOk(mempool.hasTx(tx3.hash()));
        assert.isOk(mempool.hasTx(tx4.hash()));
        assert.isOk(mempool.hasTx(tx5.hash()));
        assert.isOk(mempool.hasTx(tx6.hash()));

    });

    it('should getAllTxnHashes', async () => {
        const mempool = new factory.Mempool();
        const tx1 = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());

        mempool.addTx(tx1);
        mempool.addTx(tx2);

        assert.isOk(arrayEquals(mempool.getAllTxnHashes(), [tx1.getHash(), tx2.getHash()]));
    });

});
