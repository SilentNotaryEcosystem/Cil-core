const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('../testFactory');

describe('Witness expose message', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should FAIL to create empty', async () => {
        try {
            new factory.Messages.MsgWitnessWitnessExpose();
            assert.isOk(false, 'Unexpected success');
        } catch (e) {

        }
    });

    it('should create from MsgNextRound', async () => {

        // create message we plan to expose
        const msgToExpose = new factory.Messages.MsgWitnessNextRound({roundNo: 1, groupName: 'test'});
        const msg = new factory.Messages.MsgWitnessWitnessExpose(msgToExpose);
        assert.isOk(msg);
        assert.isOk(msg.isExpose());
        assert.isOk(Buffer.isBuffer(msg.content));

        // simulate receiving from wire
        const msgWitnessCommon = new factory.Messages.MsgWitnessCommon(new factory.Messages.MsgCommon(msg.encode()));
        assert.isOk(msgWitnessCommon.isExpose());

        // extract original message
        const exposedMessage = factory.Messages.MsgWitnessWitnessExpose.extract(msgWitnessCommon);
        assert.isOk(exposedMessage.isNextRound());
        const msgNextRound = new factory.Messages.MsgWitnessNextRound(exposedMessage);
        assert.isOk(msgNextRound.roundNo && msgNextRound.roundNo === 1);
        assert.isOk(msgNextRound.groupName && msgNextRound.groupName === 'test');
        assert.isOk(msgNextRound.isNextRound());
    });
});
