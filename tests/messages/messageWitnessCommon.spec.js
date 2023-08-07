const {describe, it} = require('mocha');
const {assert} = require('chai');
const Mutex = require('mutex');

const config = require('../../config/test.conf');
const TestFactory = require('../testFactory');

const factory = new TestFactory(
    {
        testStorage: true,
        mutex: new Mutex(),
        workerSuspended: true,
        bDev: true
    },
    config.constants
);

describe('MessageWitnessCommon', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should NOT create message (missed concilium)', async () => {
        assert.throws(() => new factory.Messages.MsgWitnessCommon());
    });

    it('should create message', async () => {
        new factory.Messages.MsgWitnessCommon({conciliumId: 0});
    });

    it('should FAIL set content (requires buffer)', async () => {
        const msg = new factory.Messages.MsgWitnessCommon({conciliumId: 0});
        assert.throws(() => msg.content = '123');
    });

    it('should set/get content', async () => {
        const msg = new factory.Messages.MsgWitnessCommon({conciliumId: 0});
        const value = Buffer.from([1, 2, 3, 4]);
        msg.content = value;
        assert.isOk(msg.content.equals(value));
    });

    it('should sign/verify payload', async () => {
        const keyPair = factory.Crypto.createKeyPair();

        const msg = new factory.Messages.MsgWitnessCommon({conciliumId: 0});
        msg.content = Buffer.from([1, 2, 3, 4]);
        msg.sign(keyPair.getPrivate());

        assert.isOk(msg.signature);
        assert.isOk(msg.verifySignature(keyPair.publicKey));
    });
});
