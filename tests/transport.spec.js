const {describe, it} = require('mocha');
const {assert} = require('chai');
const debug = require('debug')('transport:');

const factory = require('./testFactory');
const {sleep} = require('../utils');
const dns = require('dns');
const util = require('util');
const net = require('net');
const os = require('os');
const ipaddr = require('ipaddr.js');
const sinon = require('sinon').createSandbox();

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

    // it('experiment', async () => {
    //     const addr = factory.Ipv6Transport.getIpv6MappedAddress('87.250.250.242');
    //     const endpoint = new factory.Ipv6Transport({listenAddr: addr});
    //     endpoint._listen = sinon.fake.returns();
    //     await endpoint.listen();
    //     assert.isOk(endpoint.routableAddress);
    //     assert.isOk(endpoint.privateAddress);
    // });
    // it('experiment 2', async () => {
    //     const addr = factory.Ipv6Transport.getIpv6MappedAddress('192.168.1.2');
    //     const endpoint = new factory.Ipv6Transport({listenAddr: addr});
    //     endpoint._listen = sinon.fake.returns();
    //     await endpoint.listen();
    //     assert.isOk(endpoint.routableAddress);
    //     assert.isOk(endpoint.privateAddress);
    // });
    // it('experiment 3', async () => {
    //     const addr = '192.168.1.2';
    //     const endpoint = new factory.Ipv6Transport({listenAddr: addr});
    //     endpoint._listen = sinon.fake.returns();
    //     await endpoint.listen();
    //     assert.isOk(endpoint.routableAddress);
    //     assert.isOk(endpoint.privateAddress);
    // });

    it('should get addresses from dns', async function () {
        const name = 'ya.ru';
        const addresses = await factory.Ipv6Transport.resolveName(name);
        assert.isOk(addresses);
        assert.isOk(Array.isArray(addresses));
    });

    it('should get ipv6 address', async function () {
        assert.isOk(factory.Ipv6Transport.getIpv6MappedAddress('192.168.1.2'));
        assert.isOk(factory.Ipv6Transport.getIpv6MappedAddress('87.250.250.242'));
        assert.isOk(factory.Ipv6Transport.getIpv6MappedAddress('::ffff:c0a8:102'));
    });

    it('should get addresses', async () => {
        const endpoint = new factory.Ipv6Transport();
        await endpoint.listen();
        assert.isOk(endpoint.routableAddress);
        assert.isOk(endpoint.privateAddress);
    });

    it('should not get port mappings', async () => {
        const endpoint = new factory.Ipv6Transport();
        const portMappings = await endpoint._getPortMappings();
        assert.isNotOk(portMappings);
    });

    it('should get port mappings', async () => {
        const endpoint = new factory.Ipv6Transport();
        await endpoint._mapPort();
        const portMappings = await endpoint._getPortMappings();
        assert.isOk(portMappings);
        assert.isOk(Array.isArray(portMappings));
    });

    it('should set the passed routable ipv6 address', async () => {
        const endpoint = new factory.Ipv6Transport({listenAddr: factory.Ipv6Transport.getIpv6MappedAddress('87.250.250.242')});
        endpoint._listen = sinon.fake.returns();
        await endpoint.listen();
        assert.isOk(endpoint.privateAddress);
        assert.isOk(endpoint.routableAddress);
    });

    it('should listen on the passed ipv4 address', async () => {
        const ipv4Address = '127.0.0.1';
        const endpoint = new factory.Ipv6Transport({listenPort: 1234, listenAddr: ipv4Address});
        await endpoint.listen();
        assert.isOk(endpoint.privateAddress);
        assert.isOk(endpoint.routableAddress);
    });

    it('should listen on the passed ipv6 address', async () => {
        const ipv6Address = '::1';
        const endpoint = new factory.Ipv6Transport({listenPort: 1235, listenAddr: ipv6Address});
        await endpoint.listen();
        assert.isOk(endpoint.privateAddress);
        assert.isOk(endpoint.routableAddress);
    });

    // it('should define real address as local', async () => {
    //     const endpoint = new factory.Ipv6Transport();
    //     endpoint._isInterfaceAddress = sinon.fake.returns(true);
    //     await endpoint.listen();

    //     assert.isOk(endpoint.privateAddress);
    //     assert.isOk(endpoint.routableAddress);
    //     assert.equal(endpoint.privateAddress, endpoint.routableAddress);
    //     endpoint.cleanUp();
    //     endpoint.stopServer();
    // });

    it('should communicate each other', async () => {
        const address = '::1'
        const endpoint1 = new factory.Ipv6Transport({listenPort: 1236, listenAddr: address});
        const endpoint2 = new factory.Ipv6Transport();

        const [connection1, connection2] = await Promise.all([
            endpoint1.listenSync(),
            endpoint2.connect(endpoint1.routableAddress, endpoint1.port)
        ]);

        assert.isOk(connection1);
        assert.isOk(connection2);

        const msgPromise = connection2.receiveSync();
        await connection1.sendMessage(msgCommon);

        const result = await msgPromise;
        assert.isOk(result.message);
    });
});
