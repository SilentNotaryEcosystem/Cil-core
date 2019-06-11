const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('../testFactory');

describe('MessageCommon', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create message', async () => {
        const msg = new factory.Messages.MsgCommon();
        assert.isOk(msg.network);
        assert.equal(msg.network, factory.Constants.network);
    });

    it('should create message', async () => {
        const msg = new factory.Messages.MsgCommon();
        assert.isOk(msg.network);
    });

    it('should set/get payload', async () => {
        const msg = new factory.Messages.MsgCommon();
        msg.payload = Buffer.from('1235');
        assert.isOk(msg.payload);
        assert.equal(msg.payload.toString(), '1235');
    });

    it('should sign/verify payload', async () => {
        const keyPair = factory.Crypto.createKeyPair();

        const msg = new factory.Messages.MsgCommon();
        msg.payload = Buffer.from('1235');
        msg.sign(keyPair.getPrivate());

        assert.isOk(msg.signature);
        assert.isOk(msg.verifySignature(keyPair.publicKey));
    });

    it('should get pubKey of signed message', async () => {
        const keyPair = factory.Crypto.createKeyPair();

        const msg = new factory.Messages.MsgCommon();
        msg.payload = Buffer.from('1235');
        msg.sign(keyPair.getPrivate());

        assert.isOk(msg.address);
        assert.equal(msg.address, keyPair.address);
    });
});
