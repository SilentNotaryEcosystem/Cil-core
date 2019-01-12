const {describe, it} = require('mocha');
const {assert} = require('chai');
const debug = require('debug')('transport:');

const factory = require('./testFactoryIpV6');
const sinon = require('sinon').createSandbox();

let msgCommon;

const port = 8223;

describe('IPv6 Transport', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();

        msgCommon = new factory.Messages.MsgCommon();
        msgCommon.message = 'test';
    });

    after(async function() {
        this.timeout(15000);
    });

    // it('experiment', async () => {
    //     const addr = factory.Transport.toIpV6Address('87.250.250.242');
    //     const endpoint = new factory.Transport({listenAddr: addr});
    //     endpoint._listen = sinon.fake.returns();
    //     await endpoint.listen();
    //     assert.isOk(endpoint.myAddress);
    //     assert.isOk(endpoint.privateAddress);
    // });
    // it('experiment 2', async () => {
    //     const addr = factory.Transport.toIpV6Address('192.168.1.2');
    //     const endpoint = new factory.Transport({listenAddr: addr});
    //     endpoint._listen = sinon.fake.returns();
    //     await endpoint.listen();
    //     assert.isOk(endpoint.myAddress);
    //     assert.isOk(endpoint.privateAddress);
    // });
    // it('experiment 3', async () => {
    //     const addr = '192.168.1.2';
    //     const endpoint = new factory.Transport({listenAddr: addr});
    //     endpoint._listen = sinon.fake.returns();
    //     await endpoint.listen();
    //     assert.isOk(endpoint.myAddress);
    //     assert.isOk(endpoint.privateAddress);
    // });

    it('should convert address to buffer', async () => {
        const buff = factory.Transport.strToAddress('::1');
        assert.isOk(Buffer.isBuffer(buff));
        assert.equal(buff.length, 16);
    });

    it('should decode address from buffer', async () => {
        const buff = factory.Transport.strToAddress('::1');
        const strAddress = factory.Transport.addressToString(buff);
        assert.equal(strAddress, '::1');
    });

    it('should check routable address', async function() {
        let address = '2001:4860:4860::8888';
        const result = await factory.Transport.isRoutableIpV6Address(address);
        assert.isOk(result);
    });

    it('should fail to check routable address', async function() {
        let address = factory.Transport.toIpV6Address('192.168.1.2');
        const result = await factory.Transport.isRoutableIpV6Address(address);
        assert.isNotOk(result);
    });

    it('should get addresses from dns', async function() {
        this.timeout(5000);

        const name = 'ya.ru';
        const arrAddresses = await factory.Transport.resolveName(name);
        assert.isOk(arrAddresses);
        assert.isOk(arrAddresses.every(addr => typeof addr === 'string'));
        assert.isOk(Array.isArray(arrAddresses));
    });

    it('should get ipv6 address', async function() {
        assert.isOk(factory.Transport.toIpV6Address('192.168.1.2'));
        assert.isOk(factory.Transport.toIpV6Address('87.250.250.242'));
        assert.isOk(factory.Transport.toIpV6Address('::ffff:c0a8:102'));
    });

    it('should get addresses', async function() {
        this.timeout(5000);
        const endpoint = new factory.Transport({listenAddr: '192.168.1.2'});

        endpoint._upnpClient = {
            portMapping: sinon.fake.yields(null),
            getMappings: sinon.fake.yields(null, [
                {
                    public: {port: endpoint.port, host: '1.2.3.4'},
                    private: {port: endpoint.port, host: '192.168.1.2'}
                }
            ]),
            externalIp: sinon.fake.yields(null, '1.2.3.4')
        };
        endpoint._startListen = sinon.fake();

        await endpoint.listen();
        assert.isOk(endpoint.myAddress);
        assert.equal(endpoint.myAddress, '1.2.3.4');
        assert.isOk(endpoint.privateAddress);
        assert.equal(endpoint.privateAddress, '192.168.1.2');
    });

    it('should not get port mappings', async () => {
        const endpoint = new factory.Transport();
        const portMappings = await endpoint._getPortMappings();
        assert.isNotOk(portMappings);
    });

    it('should get port mappings', async () => {
        const endpoint = new factory.Transport();

        endpoint._upnpClient = {
            portMapping: sinon.fake.yields(null),
            getMappings: sinon.fake.yields(null, [
                {
                    public: {port: endpoint.port, host: '1.2.3.4'},
                    private: {port: endpoint.port, host: '192.168.1.2'}
                }
            ])
        };

        await endpoint._mapPort();
        const portMappings = await endpoint._getPortMappings();
        assert.isOk(portMappings);
        assert.isOk(Array.isArray(portMappings));
    });

    it('should set the passed routable ipv6 address', async () => {
        const endpoint = new factory.Transport(
            {listenAddr: factory.Transport.toIpV6Address('87.250.250.242')});
        endpoint._startListen = sinon.fake();

        await endpoint.listen();

        assert.isOk(endpoint.privateAddress);
        assert.isOk(endpoint.myAddress);
    });

    it('should MAP private ipv4 address', async () => {
        const ipv4Address = '127.0.0.1';
        const endpoint = new factory.Transport({listenPort: 1234, listenAddr: ipv4Address});

        endpoint._startListen = sinon.fake();
        endpoint._mapPort = sinon.fake();
        endpoint._getPortMappings = sinon.fake.resolves([
            {
                public: {port: endpoint.port, host: '1.2.3.4'},
                private: {port: endpoint.port, host: '127.0.0.1'}
            }
        ]);

        await endpoint.listen();

        assert.isOk(endpoint._mapPort.calledOnce);
        assert.isOk(endpoint._getPortMappings.calledOnce);
        assert.isOk(endpoint._startListen.calledOnce);

        assert.isOk(endpoint.privateAddress);
        assert.isOk(endpoint.myAddress);
    });

    it('should listen on routable ipv6 address', async () => {
        const ipv6Address = '::1';
        const endpoint = new factory.Transport({listenPort: 1235, listenAddr: ipv6Address});
        await endpoint.listen();
        assert.isOk(endpoint.privateAddress);
        assert.isOk(endpoint.myAddress);
    });

    it('should communicate each other', async () => {
        const address = '::1';
        const endpoint1 = new factory.Transport({listenPort: 1236, listenAddr: address});
        const endpoint2 = new factory.Transport();

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
