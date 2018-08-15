const {describe, it} = require('mocha');
const {assert} = require('chai');
const debug = require('debug')('transport:');

const factory = require('./testFactory');
const {sleep} = require('../utils');

let msgCommon;

describe('TestTransport', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();

        msgCommon = new factory.Messages.MsgCommon();
        msgCommon.message = 'test';
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should convert STRING address to BUFFER address', async function() {
        const strAddr = 'address';
        assert.isOk(typeof strAddr === 'string');
        const result = factory.Transport.strToAddress(strAddr);
        assert.isOk(Buffer.isBuffer(result));
    });

    it('should convert BUFFER address to STRING address', async function() {
        const buffAddress = factory.Transport.generateAddress();
        const result = factory.Transport.addressToString(buffAddress);
        assert.isOk(typeof result === 'string');
        assert.isOk(buffAddress.equals(factory.Transport.strToAddress(result)));
    });

    it('should get address AS buffer', async function() {
        this.timeout(10000);
        const strAddress = factory.Transport.generateAddress();
        const endpoint1 = new factory.Transport({delay: 0, listenAddr: strAddress});
        const myAddr = endpoint1.myAddress;
        assert.isOk(Buffer.isBuffer(myAddr));
    });

    it('should communicate each other (NO delay)', async () => {
        const address = factory.Transport.addressToString('rendezvous1');
        const endpoint1 = new factory.Transport({delay: 0, listenAddr: address});
        const endpoint2 = new factory.Transport({delay: 0});

        const [connection1, connection2] = await Promise.all([
            endpoint1.listenSync(),
            endpoint2.connect(address)
        ]);

        assert.isOk(connection1);
        assert.isOk(connection2);

        const msgPromise = connection2.receiveSync();
        await connection1.sendMessage(msgCommon);

        const result = await msgPromise;
        assert.isOk(result.message);
        assert.equal("" + connection2.remoteAddress, "" + address);
    });

    it('should communicate each other', async () => {
        const address = factory.Transport.addressToString('rendezvous2');
        const endpoint1 = new factory.Transport({delay: 200, listenAddr: address});
        const endpoint2 = new factory.Transport({delay: 200});

        const [connection1, connection2] = await Promise.all([
            endpoint1.listenSync(),
            endpoint2.connect(address)
        ]);

        assert.isOk(connection1);
        assert.isOk(connection2);

        const msgPromise = connection2.receiveSync();
        await connection1.sendMessage(msgCommon);

        const result = await msgPromise;
        assert.isOk(result.message);
        assert.equal("" + connection2.remoteAddress, "" + address);
    });

    it('should receive only ONE message (timeout with second one)', async () => {
        const address = factory.Transport.generateAddress();
        const endpoint1 = new factory.Transport({delay: 0, listenAddr: address});
        const endpoint2 = new factory.Transport({delay: 0});

        const [connection1, connection2] = await Promise.all([
            endpoint1.listenSync(),
            endpoint2.connect(address)
        ]);

        assert.isOk(connection1);
        assert.isOk(connection2);

        const msgPromise = connection2.receiveSync();
        await connection1.sendMessage(msgCommon);

        const result = await msgPromise;
        assert.isOk(result.message);

        // try to receive second message
        const result2 = await Promise.race([connection2.receiveSync(), sleep(1000)]);

        // timeout reached
        assert.isNotOk(result2);
    });

    it('should FAIL or timeout 3 sec (different addresses)', async function() {
        this.timeout(10000);
        const address1 = factory.Transport.generateAddress();
        const address2 = factory.Transport.generateAddress();

        const endpoint1 = new factory.Transport({delay: 200, listenAddr: address1, timeout: 3000});
        const endpoint2 = new factory.Transport({delay: 200, timeout: 3000});

        let connection1, connection2;
        try {
            ([connection1, connection2] = await Promise.all([
                endpoint1.listenSync(),
                endpoint2.connect(address2)
            ]));
            assert.isOk(false, 'Unexpected success');
        } catch (err) {
            debug(err);
        }
        assert.isNotOk(connection1);
    });

    it('should simulate network latency (3 sec)', async function() {
        this.timeout(10000);
        const address = factory.Transport.generateAddress();
        const tsStarted = Date.now();

        const endpoint1 = new factory.Transport({delay: 0, listenAddr: address});

        // we expect roundtrip delay 3 sec
        const endpoint2 = new factory.Transport({delay: 1500});

        const [connection1, connection2] = await Promise.all([
            endpoint1.listenSync(),
            endpoint2.connect(address)
        ]);

        assert.isOk(connection1);
        assert.isOk(connection2);

        const msgPromise = connection2.receiveSync();
        connection1.sendMessage(msgCommon);

        const result = await msgPromise;
        const tsFinished = Date.now();

        assert.isOk(result);
        assert.isOk(result.message);
        assert.isOk(tsFinished - tsStarted >= 3000);
    });

});
