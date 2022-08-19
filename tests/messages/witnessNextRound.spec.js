const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('../testFactory');

describe('Witness NextRound message', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function () {
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
        const msg = new factory.Messages.MsgWitnessNextRound({roundNo: 1, conciliumId: 0});
        assert.isOk(msg.roundNo && msg.roundNo === 1);
        assert.isOk(msg.conciliumId === 0);
        assert.isOk(msg.isNextRound());
    });

    it('should encode/decode', async () => {
        const msg = new factory.Messages.MsgWitnessNextRound({roundNo: 1, conciliumId: 0});
        const mockReceivedMsg = new factory.Messages.MsgCommon(msg.encode());
        assert.isOk(mockReceivedMsg);
        const msgNextRound = new factory.Messages.MsgWitnessNextRound(mockReceivedMsg);
        assert.isOk(msgNextRound);
        assert.isOk(msgNextRound.isNextRound());
        assert.isOk(msgNextRound.roundNo && msgNextRound.roundNo === 1);
        assert.isOk(msgNextRound.conciliumId === 0);
    });

    it('should get content as roundNo', async () => {
        const sampleMsg = new factory.Messages.MsgWitnessNextRound({roundNo: 13, conciliumId: 0});
        assert.equal(sampleMsg.roundNo, sampleMsg.content.roundNo);
        assert.equal(sampleMsg.roundNo, 13);
    });
});
