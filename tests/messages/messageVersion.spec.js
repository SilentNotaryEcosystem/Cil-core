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

let msgTemplate;

describe('Version Message', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();

        msgTemplate = {
            nonce: 12,
            peerInfo: {
                capabilities: [
                    {service: factory.Constants.NODE},
                    {service: factory.Constants.WITNESS, data: Buffer.from('asdasdasd')}
                ],
                address: {
                    addr0: 0x2001,
                    addr1: 0xdb8,
                    addr2: 0x1234,
                    addr3: 0x3
                }
            }
        };
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create empty MsgVersion', async () => {
        const msgVersion = new factory.Messages.MsgVersion({nonce: 1});
        assert.isOk(msgVersion);
        assert.isOk(msgVersion.isVersion());
    });

    it('should create MsgVersion from object', async () => {
        const msgVersion = new factory.Messages.MsgVersion(msgTemplate);
        assert.isOk(msgVersion);
        assert.isOk(msgVersion.isVersion());
        assert.isOk(msgVersion.protocolVersion && msgVersion.protocolVersion === factory.Constants.protocolVersion);
        assert.isOk(msgVersion.data);
        assert.isOk(msgVersion.data.peerInfo);
        assert.isOk(msgVersion.data.timeStamp);
        assert.isOk(msgVersion.data.nonce);
    });

    it('should create MsgVersion from MsgCommon', async () => {
        const msgVersion = new factory.Messages.MsgVersion(msgTemplate);
        const buff = msgVersion.encode();
        const msgCommon = new factory.Messages.MsgCommon(buff);
        assert.isOk(msgCommon);
        const reconstructedVersion = new factory.Messages.MsgVersion(msgCommon);

        assert.isOk(reconstructedVersion);
        assert.isOk(msgVersion.isVersion());
        assert.isOk(msgVersion.protocolVersion && msgVersion.protocolVersion === factory.Constants.protocolVersion);
        assert.isOk(reconstructedVersion.data);
        assert.isOk(reconstructedVersion.data.peerInfo);
        assert.isOk(reconstructedVersion.data.timeStamp);
        assert.isOk(reconstructedVersion.data.nonce);

    });

    it('should pass encoding/decoding MsgVersion', async () => {
        const msgVersion = new factory.Messages.MsgVersion(msgTemplate);
        assert.isOk(msgVersion);
        const buff = msgVersion.encode();
        assert.isOk(buff);
        assert.isOk(Buffer.isBuffer(buff));
        assert.isOk(buff.length);

        const decodedMessage = new factory.Messages.MsgVersion(buff);

        const reEncoded = decodedMessage.encode();
        assert.isOk(buff.equals(reEncoded));
    });

    it('should sign/verify payload', async () => {
        const keyPair = factory.Crypto.createKeyPair();
        const message = new factory.Messages.MsgVersion(msgTemplate);
        message.encode();
        message.sign(keyPair.getPrivate());
        assert.isOk(message.signature);
        assert.isOk(message.verifySignature(keyPair.getPublic(false, false)));
    });
});
