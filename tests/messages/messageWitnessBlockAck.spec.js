'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const {createDummyTx, pseudoRandomBuffer} = require('../testUtil');

const factory = require('../testFactory');

describe('MessageWitnessBlockAck', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should NOT create message', async () => {
        const wrapper = () => new factory.Messages.MsgWitnessBlockAck();
        assert.throws(wrapper);
    });

    it('should NOT create message (bad block hash)', async () => {
        const wrapper = () => new factory.Messages.MsgWitnessBlockAck({groupName: 'test', blockHash: '123'});
        assert.throws(wrapper);
    });

    it('should create message', async () => {
        new factory.Messages.MsgWitnessBlockAck({groupName: 'test', blockHash: pseudoRandomBuffer()});
    });

    it('should encode/decode message', async () => {
        const blockHash = pseudoRandomBuffer();
        const msg = new factory.Messages.MsgWitnessBlockAck({groupName: 'test', blockHash});
        const keyPair = factory.Crypto.createKeyPair();
        msg.sign(keyPair.privateKey);
        const buffMsg = msg.encode();

        const recoveredMsg = new factory.Messages.MsgWitnessBlockAck(buffMsg);
        assert.isOk(recoveredMsg.isWitnessBlockAccept());
        assert.isOk(recoveredMsg.verifySignature(keyPair.publicKey));
        assert.isOk(blockHash.equals(recoveredMsg.blockHash));
        assert.isOk(factory.Crypto.verify(recoveredMsg.blockHash, recoveredMsg.hashSignature, keyPair.publicKey));
    });

});
