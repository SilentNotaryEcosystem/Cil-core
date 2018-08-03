const {describe, it} = require('mocha');
const {assert} = require('chai');
const {inspect} = require('util');
const debug = require('debug')('serializer');

const factory = require('./testFactory');

describe('Serializer', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should serialize message', async () => {
        const msgVersion = new factory.Messages.MsgVersion({
            nonce: 12,
            peerInfo: {
                capabilities: [
                    {service: factory.Constants.NODE, data: null},
                    {service: factory.Constants.WITNESS, data: Buffer.from('asdasdasd')}
                ],
                address: {
                    addr0: 0x2001,
                    addr1: 0xdb8,
                    addr2: 0x1234,
                    addr3: 0x3
                }
            }
        });
        const buff = factory.Serializer.serialize(msgVersion);
        const buff2 = msgVersion.encode();
        assert.isOk(buff);
        assert.isOk(Buffer.isBuffer(buff));
        assert.isOk(buff.equals(buff2));
        assert.isOk(buff.length);
        debug(inspect(buff, {colors: true, depth: null, breakLength: Infinity, compact: false}));
    });

    it('should deserialize message', async () => {
        const serializedMessage = [
            61, 8, 132, 198, 160, 148, 1, 26, 7, 118, 101, 114, 115, 105, 111, 110, 50, 44, 16, 204, 235, 250, 218, 5,
            26, 32, 10, 2, 8, 1, 10, 13, 8, 2, 18, 9, 97, 115, 100, 97, 115, 100, 97, 115, 100, 18, 11, 8, 129, 64, 16,
            184, 27, 24, 180, 36, 32, 3, 32, 133, 228, 3];
        const msg = factory.Serializer.deSerialize(Buffer.from(serializedMessage));
        assert.isOk(msg);
        assert.isOk(msg instanceof factory.Messages.MsgVersion);
        debug(msg);
    });

    it('should FAIL to deserialize PARTIAL message', async () => {
        const serializedMessage = [
            61, 8, 132, 198, 160, 148, 1, 26, 7, 118, 101, 114, 115, 105, 111, 110, 50, 44, 16, 204, 235, 250, 218, 5,
            26, 32, 10, 2];
        let msg;
        try {
            msg = factory.Serializer.deSerialize(Buffer.from(serializedMessage));
            assert.isOk(false, 'Unexpected success');
        } catch (err) {
            assert.isNotOk(msg);
            debug(err);
        }
    });
});
