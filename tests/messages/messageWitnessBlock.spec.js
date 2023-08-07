'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const Mutex = require('mutex');

const config = require('../../config/test.conf');
const TestFactory = require('../testFactory');
const {createDummyTx, createDummyBlock} = require('../testUtil');

const factory = new TestFactory(
    {
        testStorage: true,
        mutex: new Mutex(),
        workerSuspended: true,
        bDev: true
    },
    config.constants
);

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
        const msg = new factory.Messages.MsgWitnessBlock({conciliumId: 0});
        assert.isOk(msg.isWitnessBlock());
    });

    it('should encode/decode message', async () => {
        const msg = new factory.Messages.MsgWitnessBlock({conciliumId: 0});

        const block = createDummyBlock(factory);
        const keyPair = factory.Crypto.createKeyPair();

        msg.block = block;
        msg.sign(keyPair.privateKey);

        const buffMsg = msg.encode();
        assert.isOk(Buffer.isBuffer(buffMsg));

        const restoredMsg = new factory.Messages.MsgWitnessBlock(buffMsg);
        assert.isOk(restoredMsg.signature);
        assert.isOk(restoredMsg.address);
        assert.equal(restoredMsg.address, keyPair.address);

        const restoredBlock = restoredMsg.block;
        assert.equal(block.hash(), restoredBlock.hash());
        assert.isOk(Array.isArray(restoredBlock.txns));
        assert.equal(restoredBlock.txns.length, 1);

        const restoredTx = new factory.Transaction(restoredBlock.txns[0]);
        assert.isOk(restoredTx.isCoinbase());
    });

});
