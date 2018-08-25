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
        const msg = new factory.Messages.MsgWitnessBlock({groupName: 'test'});
        assert.isOk(msg.isWitnessBlock());
    });

    it('should encode/decode message', async () => {
        const msg = new factory.Messages.MsgWitnessBlock({groupName: 'test'});

        const block = new factory.Block();
        const keyPair = factory.Crypto.createKeyPair();
        const tx = new factory.Transaction({payload: txPayload});
        tx.sign(keyPair.privateKey);

        block.addTx(tx);
        msg.block = block;
        msg.sign(keyPair.privateKey);

        const buffMsg = msg.encode();
        assert.isOk(Buffer.isBuffer(buffMsg));

        const restoredMsg = new factory.Messages.MsgWitnessBlock(buffMsg);
        assert.isOk(restoredMsg.signature);
        assert.isOk(restoredMsg.publicKey);
        assert.equal(restoredMsg.publicKey, keyPair.publicKey);

        const restoredBlock = restoredMsg.block;
        assert.equal(block.hash, restoredBlock.hash);
        assert.isOk(Array.isArray(restoredBlock.txns));
        assert.equal(restoredBlock.txns.length, 1);
        assert.deepEqual(Object.assign({}, restoredBlock.txns[0].payload), Object.assign({}, tx.rawData.payload));
    });

});
