'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const debug = require('debug')('block:test');

const factory = require('./testFactory');
const {createDummyTx, pseudoRandomBuffer, generateAddress} = require('./testUtil');

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

    it('should create block for specified concilium', async () => {
        const block = new factory.Block(3);
        assert.equal(block.conciliumId, 3);
    });

    it('should test block header fields', async () => {
        const block = new factory.Block(7);

        const keyPair = factory.Crypto.createKeyPair();
        const tx = new factory.Transaction(createDummyTx());
        tx.claim(0, keyPair.privateKey);

        block.parentHashes = [pseudoRandomBuffer().toString('hex'), pseudoRandomBuffer().toString('hex')];

        block.addTx(tx);
        block.finish(factory.Constants.fees.TX_FEE, keyPair.address);

        assert.isOk(block.header.timestamp);
        assert.isOk(block.timestamp);
        assert.equal(block.header.version, 1);
        assert.equal(block.header.conciliumId, 7);

        assert.isOk(Array.isArray(block.header.parentHashes));
        assert.equal(block.header.parentHashes.length, 2);
        assert.isOk(Buffer.isBuffer(block.header.parentHashes[0]));

        assert.isOk(block.getHash());
        assert.isOk(Buffer.isBuffer(block.header.merkleRoot));
    });

    it('should test getter/setters', async () => {
        const block = new factory.Block(0);

        block.parentHashes = [pseudoRandomBuffer().toString('hex'), pseudoRandomBuffer().toString('hex')];
        assert.isOk(Array.isArray(block.parentHashes));
        assert.isOk(block.parentHashes.length, 2);
        assert.isOk(typeof block.parentHashes[0] === 'string');

    });

    it('should calc hash', async () => {
        const block = new factory.Block(0);
        const keyPair = factory.Crypto.createKeyPair();
        const tx = new factory.Transaction(createDummyTx());
        tx.claim(0, keyPair.privateKey);

        block.addTx(tx);
        block.finish(factory.Constants.fees.TX_FEE, keyPair.address);

        const hash = block.hash();
        debug(block.hash());

        assert.isOk(typeof hash === 'string');
        assert.equal(hash.length, 64);

        // next hash call - return same value
        assert.equal(hash, block.hash());

        const anotherBlock = new factory.Block(0);
        const anotherTx = new factory.Transaction(createDummyTx());
        anotherTx.claim(0, keyPair.privateKey);
        anotherBlock.addTx(anotherTx);
        anotherBlock.finish(factory.Constants.fees.TX_FEE, keyPair.address);

        debug(anotherBlock.hash());
        assert.notEqual(block.hash(), anotherBlock.hash());
    });

    it('should encode/decode', async () => {
        const block = new factory.Block(0);
        const keyPair = factory.Crypto.createKeyPair();
        const tx = new factory.Transaction(createDummyTx());
        tx.claim(0, keyPair.privateKey);

        block.addTx(tx);
        block.finish(factory.Constants.fees.TX_FEE, keyPair.address);

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

    describe('Coinbase creation', async () => {
        let block;

        beforeEach(async () => {
            block = new factory.Block(0);
        });

        it('should create coinbase', async () => {
            block.finish(1e6, generateAddress());
            assert.isOk(block.txns.length, 1);
        });

        it('should create 3 outputs', async () => {
            block.finish(1e6, generateAddress());

            const tx = new factory.Transaction(block.txns[0]);
            assert.isOk(Array.isArray(tx.outputs) && tx.outputs.length === 3);
        });

        it('should create 2 outputs (without foundation share, because its 2 small)', async () => {
            block.finish(1e4, generateAddress(), 1e4);

            const tx = new factory.Transaction(block.txns[0]);
            assert.isOk(Array.isArray(tx.outputs) && tx.outputs.length === 2);
        });

        it('should create 1 output (to make random hash for coinbase tx)', async () => {
            block.finish(1e4, generateAddress(), 1e4);

            const tx = new factory.Transaction(block.txns[0]);
            assert.isOk(Array.isArray(tx.outputs) && tx.outputs.length === 2);
        });
    });

    describe('Block verification', async () => {
        it('should FAIL to verify parentHashes', async () => {
            const block = new factory.Block(0);
            assert.throws(() => block.verify(), 'Bad block parents');
        });
        it('should FAIL to verify signatures', async () => {
            const block = new factory.Block(0);
            block.parentHashes = [pseudoRandomBuffer()];
            assert.throws(() => block.verify(), 'Bad block signatures');
        });
        it('should SKIP verifying signatures', async () => {
            const block = new factory.Block(0);
            block.parentHashes = [pseudoRandomBuffer()];
            assert.throws(() => block.verify(false), /Empty block/);
        });
        it('should FAIL to verify merkleRoot', async () => {
            const block = new factory.Block(0);
            block.parentHashes = [pseudoRandomBuffer()];
            block.addWitnessSignatures([pseudoRandomBuffer(65)]);
            block.addTx(factory.Transaction.createCoinbase());
            assert.throws(() => block.verify(), 'Bad merkle root');
        });
        it('should FAIL to verify height', async () => {
            const block = new factory.Block(0);
            block.parentHashes = [pseudoRandomBuffer()];
            block.addWitnessSignatures([pseudoRandomBuffer(65)]);

            block.finish(factory.Constants.fees.TX_FEE, generateAddress());
            assert.throws(() => block.verify(), 'Bad height');
        });

        it('should SUCCESS to verify empty block', async () => {
            const block = new factory.Block(0);
            block.parentHashes = [pseudoRandomBuffer()];
            block.addWitnessSignatures([pseudoRandomBuffer(65)]);
            block.finish(factory.Constants.fees.TX_FEE, generateAddress());
            block.setHeight(20);
            block.verify();
        });

        it('should FAIL to verify block with wrong tx.conciliumId', async () => {
            const block = new factory.Block(0);
            block.parentHashes = [pseudoRandomBuffer()];
            const tx = new factory.Transaction(createDummyTx(undefined, 1))
            block.addTx(tx);
            block.addWitnessSignatures([pseudoRandomBuffer(65)]);
            block.finish(factory.Constants.fees.TX_FEE, generateAddress());
            block.setHeight(20);

            assert.throws(() => block.verify(), 'Found tx with wrong conciliumId');
        });
    });
});
