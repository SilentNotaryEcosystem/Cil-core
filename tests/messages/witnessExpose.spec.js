const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('../testFactory');

describe('Witness expose message', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function () {
        this.timeout(15000);
    });

    it('should FAIL to create empty', async () => {
        const wrapper = () => new factory.Messages.MsgWitnessWitnessExpose();
        assert.throws(wrapper);
    });

    it('should create from MsgNextRound', async () => {
        const strPrivKey = 'b7760a01705490e5e153a6ef7732369a72dbf9aaafb5c482cdfd960546909ec1';

        // create message we plan to expose
        const msgToExpose = new factory.Messages.MsgWitnessNextRound({roundNo: 1, conciliumId: 0});
        msgToExpose.sign(strPrivKey);
        const msg = new factory.Messages.MsgWitnessWitnessExpose(msgToExpose);
        msg.sign(strPrivKey);
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
        assert.isOk(msgNextRound.conciliumId === 0);
        assert.isOk(msgNextRound.isNextRound());
    });
});
