const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('../testFactory');

let templateMsg;

describe('Addr Message', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();

        templateMsg = {
            peers: [
                {
                    capabilities: [
                        {service: factory.Constants.NODE, data: null},
                        {service: factory.Constants.WITNESS, data: Buffer.from('asdasdasd')}
                    ],
                    address: {
                        addr0: 0x2001,
                        addr1: 0xdb8,
                        addr2: 0x1234,
                        addr3: 0x3
                    },
                    port: 12345
                }
            ]
        };
    });

    after(async function () {
        this.timeout(15000);
    });

    it('should create empty MsgAddr', async () => {
        const msgAddr = new factory.Messages.MsgAddr();
        assert.isOk(msgAddr);
        assert.isOk(msgAddr.isAddr());
    });

    it('should create MsgAddr from object', async () => {
        const msgAddr = new factory.Messages.MsgAddr(templateMsg);
        assert.isOk(msgAddr);
        assert.isOk(msgAddr.isAddr());
    });

    it('should create MsgAddr from MsgCommon', async () => {
        const msgAddr = new factory.Messages.MsgAddr(templateMsg);
        assert.isOk(msgAddr);
        const buff = msgAddr.encode();
        const msgCommon = new factory.Messages.MsgCommon(buff);
        assert.isOk(msgCommon);
        const reconstructedAddr = new factory.Messages.MsgAddr(msgCommon);

        assert.isOk(reconstructedAddr.isAddr());
    });

    it('tests getters/setters', async () => {
        const msgAddr = new factory.Messages.MsgAddr(templateMsg);
        assert.isOk(msgAddr.peers);
    });

    it('should pass encoding/decoding MsgAddr', async () => {
        const msgAddr = new factory.Messages.MsgAddr(templateMsg);
        const result = msgAddr.encode();
        assert.isOk(result);
        assert.isOk(Buffer.isBuffer(result));
        assert.isOk(result.length);

        const decodedMessage = new factory.Messages.MsgAddr(result);

        const reEncoded = decodedMessage.encode();
        assert.isOk(result.equals(reEncoded));
    });
});
