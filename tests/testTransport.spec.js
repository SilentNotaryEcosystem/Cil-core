const {describe, it} = require('mocha');
const {assert} = require('chai');
const uuid = require('node-uuid');

const factory = require('./testFactory');
const {sleep} = require('../utils');

let msgVersion;

describe('TestTransport', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();

        msgVersion = new factory.Messages.MsgVersion({
            peerInfo: {
                capabilities: [],
                address: {
                    addr0: 0x2001,
                    addr1: 0xdb8,
                    addr2: 0x1234,
                    addr3: 0x3
                }
            }
        });
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should get address buffer', async function() {
        this.timeout(10000);
        const endpoint1 = new factory.Transport({delay: 0, listenAddr: 'address'});
        const myAddr = endpoint1.myAddress;
        assert.isOk(Buffer.isBuffer(myAddr));
        assert.isOk(myAddr.equals(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 97, 100, 100, 114, 101, 115, 115])));
    });

    it('should communicate each other', async () => {
        const address = uuid.v4();
        const endpoint1 = new factory.Transport({delay: 200, listenAddr: address});
        const endpoint2 = new factory.Transport({delay: 200});

        const [connection1, connection2] = await Promise.all([
            endpoint1.listenSync(),
            endpoint2.connect(address)
        ]);

        assert.isOk(connection1);
        assert.isOk(connection2);

        const msgPromise = connection2.receiveSync();
        connection1.sendMessage(msgVersion);

        const result = await msgPromise;
        assert.equal(result.message, 'version');
    });

    it('should timeout 3 sec (different addresses)', async function() {
        this.timeout(10000);
        const address1 = uuid.v4();
        const address2 = uuid.v4();

        const endpoint1 = new factory.Transport({delay: 200, listenAddr: address1, timeout: 3000});
        const endpoint2 = new factory.Transport({delay: 200, timeout: 3000});

        const [connection1, connection2] = await Promise.all([
            endpoint1.listenSync(),
            endpoint2.connect(address2)
        ]);

        assert.isNotOk(connection1);
    });

    it('should simulate network latency (3 sec)', async function() {
        this.timeout(10000);
        const address = uuid.v4();

        const endpoint1 = new factory.Transport({delay: 0, listenAddr: address});

        const endpoint2 = new factory.Transport({delay: 3000});

        const [connection1, connection2] = await Promise.all([
            endpoint1.listenSync(),
            endpoint2.connect(address)
        ]);

        assert.isOk(connection1);
        assert.isOk(connection2);

        const msgPromise = connection2.receiveSync();
        connection1.sendMessage(msgVersion);

        const tsStarted = Date.now();
        const result = await msgPromise;
        const tsFinished = Date.now();

        assert.isOk(result);
        assert.equal(result.message, 'version');
        assert.isOk(tsFinished - tsStarted >= 3000);
    });

});
