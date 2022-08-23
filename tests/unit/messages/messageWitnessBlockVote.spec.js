'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const {pseudoRandomBuffer} = require('../testUtil');

const factory = require('../testFactory');

describe('MessageWitnessBlockVote', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function () {
        this.timeout(15000);
    });

    it('should NOT create message', async () => {
        const wrapper = () => new factory.Messages.MsgWitnessBlockVote();
        assert.throws(wrapper);
    });

    it('should NOT create message (bad block hash)', async () => {
        const wrapper = () => new factory.Messages.MsgWitnessBlockVote({conciliumId: 'test', blockHash: '123'});
        assert.throws(wrapper);
    });

    it('should create message', async () => {
        new factory.Messages.MsgWitnessBlockVote({conciliumId: 0, blockHash: pseudoRandomBuffer()});
    });

    it('should get blockHash', async () => {
        const blockHash = pseudoRandomBuffer();
        const msg = new factory.Messages.MsgWitnessBlockVote({conciliumId: 0, blockHash});
        assert.isOk(blockHash.equals(msg.blockHash));
    });

    it('should verify hash & message signatures', async () => {
        const keyPair = factory.Crypto.createKeyPair();
        const blockHash = pseudoRandomBuffer();
        const msg = new factory.Messages.MsgWitnessBlockVote({conciliumId: 0, blockHash});
        msg.sign(keyPair.privateKey);

        assert.isOk(factory.Crypto.verify(blockHash, msg.hashSignature, keyPair.publicKey));
        assert.isOk(msg.verifySignature(keyPair.publicKey));
    });

    it('should encode/decode message', async () => {
        const blockHash = pseudoRandomBuffer();
        const msg = new factory.Messages.MsgWitnessBlockVote({conciliumId: 0, blockHash});
        const keyPair = factory.Crypto.createKeyPair();
        msg.sign(keyPair.privateKey);
        const buffMsg = msg.encode();

        const recoveredMsg = new factory.Messages.MsgWitnessBlockVote(buffMsg);
        assert.isOk(recoveredMsg.isWitnessBlockVote());
        assert.isOk(recoveredMsg.verifySignature(keyPair.publicKey));
        assert.isOk(blockHash.equals(recoveredMsg.blockHash));
        assert.isOk(factory.Crypto.verify(recoveredMsg.blockHash, recoveredMsg.hashSignature, keyPair.publicKey));
    });

    it('should create "REJECT" vote', async () => {
        const msg = factory.Messages.MsgWitnessBlockVote.reject('test');
        assert.isOk(msg.isWitnessBlockVote());
    });
});
