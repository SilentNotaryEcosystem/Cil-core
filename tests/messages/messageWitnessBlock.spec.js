'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const {createDummyTx, createDummyBlock} = require('../testUtil');

const factory = require('../testFactory');

describe('MessageWitnessBlock', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should NOT create message', async () => {
        const wrapper = () => new factory.Messages.MsgWitnessBlock();
        assert.throws(wrapper);
    });

    it('should create message', async () => {
        const msg = new factory.Messages.MsgWitnessBlock({groupId: 0});
        assert.isOk(msg.isWitnessBlock());
    });

    it('should encode/decode message', async () => {
        const msg = new factory.Messages.MsgWitnessBlock({groupId: 0});

        const block = createDummyBlock(factory);
        const keyPair = factory.Crypto.createKeyPair();

        msg.block = block;
        msg.sign(keyPair.privateKey);

        const buffMsg = msg.encode();
        assert.isOk(Buffer.isBuffer(buffMsg));

        const restoredMsg = new factory.Messages.MsgWitnessBlock(buffMsg);
        assert.isOk(restoredMsg.signature);
        assert.isOk(restoredMsg.publicKey);
        assert.equal(restoredMsg.publicKey, keyPair.publicKey);

        const restoredBlock = restoredMsg.block;
        assert.equal(block.hash(), restoredBlock.hash());
        assert.isOk(Array.isArray(restoredBlock.txns));
        assert.equal(restoredBlock.txns.length, 1);

        const restoredTx = new factory.Transaction(restoredBlock.txns[0]);
        assert.isOk(restoredTx.isCoinbase());
    });

});
