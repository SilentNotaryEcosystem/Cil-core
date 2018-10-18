const { describe, it } = require('mocha');
const { assert } = require('chai');
const debug = require('debug')('transport:');

const factory = require('./testFactory');
const { sleep } = require('../utils');
const dns = require('dns');
const util = require('util');
const net = require('net');
const os = require('os');
const ipaddr = require('ipaddr.js');

let msgCommon;

const port = 8223;

describe('Transport', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();

        msgCommon = new factory.Messages.MsgCommon();
        msgCommon.message = 'test';
    });

    after(async function () {
        this.timeout(15000);
    });

    it('should get addresses from dns', async function () {
        const name = 'ya.ru';
        const addresses = await factory.Ipv6Transport.resolveName(name);
        assert.isOk(addresses);
        assert.isOk(Array.isArray(addresses));
    });

    it('should get real ipv6 address', async () => {
        const endpoint = new factory.Ipv6Transport();

        assert.isOk(endpoint.myAddress);
    });

    it('should communicate each other (real address)', async () => {
        const endpoint1 = new factory.Ipv6Transport();
        const endpoint2 = new factory.Ipv6Transport();

        const [connection1, connection2] = await Promise.all([
            endpoint1.listenSync(),
            endpoint2.connect(endpoint1.myAddress, endpoint1.port)
        ]);

        assert.isOk(connection1);
        assert.isOk(connection2);

        const msgPromise = connection2.receiveSync();
        await connection1.sendMessage(msgCommon);

        const result = await msgPromise;
        assert.isOk(result.message);
    });

    it('should communicate each other (ipv6)', async () => {
        const address = '::1'
        const endpoint1 = new factory.Ipv6Transport({ listenAddr: address });
        const endpoint2 = new factory.Ipv6Transport();

        const [connection1, connection2] = await Promise.all([
            endpoint1.listenSync(),
            endpoint2.connect(endpoint1.myAddress, endpoint1.port)
        ]);

        assert.isOk(connection1);
        assert.isOk(connection2);

        const msgPromise = connection2.receiveSync();
        await connection1.sendMessage(msgCommon);

        const result = await msgPromise;
        assert.isOk(result.message);
    });

    it('should communicate each other (ipv4)', async () => {
        const address = '127.0.0.1'
        const endpoint1 = new factory.Ipv6Transport({ listenAddr: address });
        const endpoint2 = new factory.Ipv6Transport();

        const [connection1, connection2] = await Promise.all([
            endpoint1.listenSync(),
            endpoint2.connect(endpoint1.myAddress, endpoint1.port)
        ]);

        assert.isOk(connection1);
        assert.isOk(connection2);

        const msgPromise = connection2.receiveSync();
        await connection1.sendMessage(msgCommon);

        const result = await msgPromise;
        assert.isOk(result.message);
    });
});
