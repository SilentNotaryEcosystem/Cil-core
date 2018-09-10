'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const {createDummyTx} = require('../testUtil');

const factory = require('../testFactory');

describe('Message Transaction', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create empty message', async () => {
        const msg = new factory.Messages.MsgTx();
        assert.isOk(msg.network);
        assert.equal(msg.network, factory.Constants.network);
        assert.isOk(msg.isTx());
    });

    it('should set/get block', async () => {
        const msg = new factory.Messages.MsgTx();

        const keyPair = factory.Crypto.createKeyPair();
        const tx = new factory.Transaction(createDummyTx());
        tx.sign(0, keyPair.privateKey);
        msg.tx = tx;

        assert.isOk(Buffer.isBuffer(msg.payload));

        const restoredTx = msg.tx;
        assert.equal(tx.hash, restoredTx.hash);
        assert.isOk(restoredTx.equals(tx));

    });

    it('should encode/decode message', async () => {
        const msg = new factory.Messages.MsgTx();

        const keyPair = factory.Crypto.createKeyPair();
        const tx = new factory.Transaction(createDummyTx());
        tx.sign(0, keyPair.privateKey);
        msg.tx = tx;

        const buffMsg = msg.encode();
        assert.isOk(Buffer.isBuffer(buffMsg));
        const restoredMsg = new factory.Messages.MsgTx(buffMsg);

        const restoredTx = restoredMsg.tx;
        assert.equal(tx.hash, restoredTx.hash);
        assert.isOk(restoredTx.equals(tx));
    });

    it('should fail to decode block message', async () => {
        const msg = new factory.Messages.MsgTx();
        msg.payload = Buffer.from('123');

        const restoredTx = msg.tx;
        assert.isNotOk(restoredTx);
    });

});
