const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');

const factory = require('../testFactory');

const txPayload = {
    nonce: 20,
    gasLimit: 102,
    gasPrice: 21,
    to: '43543543525454',
    value: 1200,
    extField: 'extFieldextFieldextField'
};

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

    it('should set/get block', async () => {
        const msg = new factory.Messages.MsgBlock();

        const block = new factory.Block();
        const keyPair = factory.Crypto.createKeyPair();
        const tx = new factory.Transaction({payload: txPayload});
        tx.sign(keyPair.privateKey);

        block.addTx(tx);
        msg.block = block;

        const restoredBlock = msg.block;
        assert.equal(block.hash, restoredBlock.hash);
        assert.isOk(Array.isArray(restoredBlock.txns));
        assert.equal(restoredBlock.txns.length, 1);
        assert.deepEqual(Object.assign({}, restoredBlock.txns[0].payload), Object.assign({}, tx.rawData.payload));

    });

    it('should encode/decode message', async () => {
        const msg = new factory.Messages.MsgBlock();

        const block = new factory.Block();
        const keyPair = factory.Crypto.createKeyPair();
        const tx = new factory.Transaction({payload: txPayload});
        tx.sign(keyPair.privateKey);

        block.addTx(tx);
        msg.block = block;

        const buffMsg = msg.encode();
        assert.isOk(Buffer.isBuffer(buffMsg));
        const restoredMsg = new factory.Messages.MsgBlock(buffMsg);

        const restoredBlock = restoredMsg.block;
        assert.equal(block.hash, restoredBlock.hash);
        assert.isOk(Array.isArray(restoredBlock.txns));
        assert.equal(restoredBlock.txns.length, 1);
        assert.deepEqual(Object.assign({}, restoredBlock.txns[0].payload), Object.assign({}, tx.rawData.payload));
    });

    it('should fail to decode block message', async () => {
        const msg = new factory.Messages.MsgBlock();
        msg.payload = Buffer.from('123');

        const restoredBlock = msg.block;
        assert.isNotOk(restoredBlock);
    });

});
