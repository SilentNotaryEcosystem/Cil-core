'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const {createDummyTx} = require('../testUtil');

const factory = require('../testFactory');

describe('MessageBlock', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create empty message', async () => {
        const msg = new factory.Messages.MsgBlock();
        assert.isOk(msg.network);
        assert.equal(msg.network, factory.Constants.network);
        assert.isOk(msg.isBlock());
    });

    it('should create from block', async () => {
        const block = new factory.Block();
        const tx = new factory.Transaction(createDummyTx());
        block.addTx(tx);

        const msg = new factory.Messages.MsgBlock(block);
        assert.isOk(tx.equals(new factory.Transaction(msg.block.txns[0])));
    });

    it('should set/get block', async () => {
        const msg = new factory.Messages.MsgBlock();

        const block = new factory.Block();
        const keyPair = factory.Crypto.createKeyPair();
        const tx = new factory.Transaction(createDummyTx());
        tx.sign(0, keyPair.privateKey);

        block.addTx(tx);
        msg.block = block;

        const restoredBlock = msg.block;
        assert.equal(block.hash(), restoredBlock.hash());
        assert.isOk(Array.isArray(restoredBlock.txns));
        assert.equal(restoredBlock.txns.length, 1);

        const restoredTx = new factory.Transaction(restoredBlock.txns[0]);
        assert.isOk(restoredTx.equals(tx));
    });

    it('should encode/decode message', async () => {
        const msg = new factory.Messages.MsgBlock();

        const block = new factory.Block();
        const keyPair = factory.Crypto.createKeyPair();
        const tx = new factory.Transaction(createDummyTx());
        tx.sign(0, keyPair.privateKey);

        block.addTx(tx);
        msg.block = block;

        const buffMsg = msg.encode();
        assert.isOk(Buffer.isBuffer(buffMsg));
        const msgCommon = new factory.Messages.MsgCommon(buffMsg);

        const restoredMsg = new factory.Messages.MsgBlock(msgCommon);

        const restoredBlock = restoredMsg.block;
        assert.equal(block.hash(), restoredBlock.hash());
        assert.isOk(Array.isArray(restoredBlock.txns));
        assert.equal(restoredBlock.txns.length, 1);

        const restoredTx = new factory.Transaction(restoredBlock.txns[0]);
        assert.isOk(restoredTx.equals(tx));
    });

    it('should fail to decode block message', async () => {
        const msg = new factory.Messages.MsgBlock();
        msg.payload = Buffer.from('123');

        const restoredBlock = msg.block;
        assert.isNotOk(restoredBlock);
    });

});
