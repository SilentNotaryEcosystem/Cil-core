const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('../testFactory');

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
        const msgVersion = new factory.Messages.MsgVersion();
        assert.isOk(msgVersion);
        assert.equal(msgVersion.message, 'version');
    });

    it('should create MsgVersion from object', async () => {
        const msgVersion = new factory.Messages.MsgVersion(msgTemplate);
        assert.isOk(msgVersion);
        assert.equal(msgVersion.message, 'version');
        assert.isOk(msgVersion.data);
        assert.isOk(msgVersion.data.peerInfo);
        assert.isOk(msgVersion.data.timeStamp);
        assert.isOk(msgVersion.data.nonce);
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
});
