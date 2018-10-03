const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('../testFactory');

describe('Witness NextRound message', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should FAIL to create empty', async () => {
        try {
            new factory.Messages.MsgWitnessNextRound();
        } catch (e) {
            return;
        }
        assert.isOk(false, 'Unexpected success');
    });

    it('should create message', async () => {
        const msg = new factory.Messages.MsgWitnessNextRound({roundNo: 1, groupName: 'test'});
        assert.isOk(msg.roundNo && msg.roundNo === 1);
        assert.isOk(msg.groupName && msg.groupName === 'test');
        assert.isOk(msg.isNextRound());
    });

    it('should encode/decode', async () => {
        const msg = new factory.Messages.MsgWitnessNextRound({roundNo: 1, groupName: 'test'});
        const mockReceivedMsg = new factory.Messages.MsgCommon(msg.encode());
        assert.isOk(mockReceivedMsg);
        const msgNextRound = new factory.Messages.MsgWitnessNextRound(mockReceivedMsg);
        assert.isOk(msgNextRound);
        assert.isOk(msgNextRound.isNextRound());
        assert.isOk(msgNextRound.roundNo && msgNextRound.roundNo === 1);
        assert.isOk(msgNextRound.groupName && msgNextRound.groupName === 'test');
    });

    it('should get content as roundNo', async () => {
        const sampleMsg = new factory.Messages.MsgWitnessNextRound({roundNo: 13, groupName: 'test'});
        assert.equal(sampleMsg.roundNo, sampleMsg.content.roundNo);
        assert.equal(sampleMsg.roundNo, 13);
    });
});
