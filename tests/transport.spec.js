const {describe, it} = require('mocha');
const {assert} = require('chai');
const debug = require('debug')('transport:');

const factory = require('./testFactoryIpV6');
const sinon = require('sinon').createSandbox();
const {sleep} = require('./testUtil');

let msgCommon;

process.on('warning', e => console.warn(e.stack));

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

    it('should be ROUTABLE IPv6 address', async function() {
        assert.isOk(await factory.Transport.isRoutableIpV6Address('::ffff:4a77:c21a'));
        assert.isOk(await factory.Transport.isRoutableIpV6Address('2001:4860:4860::8888'));
    });

    it('should be NON ROUTABLE IPv6 address', async function() {
        assert.isNotOk(await factory.Transport.isRoutableIpV6Address('fd44:c346:f8fe:d300:5145:d4fa:badb:29bd'));
        assert.isNotOk(await factory.Transport.isRoutableIpV6Address('fe80::a04b:7081:b4ac:143'));
    });

    it('should be ROUTABLE IPv4 address', async function() {
        assert.isOk(await factory.Transport.isRoutableIpV4Address('8.8.8.8'));
    });

    it('should be NON ROUTABLE IPv4 address', async function() {
        assert.isNotOk(await factory.Transport.isRoutableIpV4Address('127.0.0.1'));
        assert.isNotOk(await factory.Transport.isRoutableIpV4Address('192.168.1.1'));
        assert.isNotOk(await factory.Transport.isRoutableIpV4Address('10.0.0.1'));
        assert.isNotOk(await factory.Transport.isRoutableIpV4Address('172.16.0.1'));
        assert.isNotOk(await factory.Transport.isRoutableIpV4Address('255.255.255.255'));
        assert.isNotOk(await factory.Transport.isRoutableIpV4Address('224.0.0.0'));
        assert.isNotOk(await factory.Transport.isRoutableIpV4Address('169.254.0.0'));
    });

    it('should get addresses from dns', async function() {
        this.timeout(5000);

        const name = 'ya.ru';
        const arrAddresses = await factory.Transport.resolveName(name);
        assert.isOk(arrAddresses);
        assert.isOk(arrAddresses.every(addr => typeof addr === 'string'));
        assert.isOk(Array.isArray(arrAddresses));
    });

    it('should convert to ipv6 address', async function() {
        assert.isOk(factory.Transport.toIpV6Address('192.168.1.2'));
        assert.isOk(factory.Transport.toIpV6Address('87.250.250.242'));
        assert.isOk(factory.Transport.toIpV6Address('::ffff:c0a8:102'));
    });

    it('should communicate each other', async function() {
        this.timeout(100000);
        const endpoint1 = new factory.Transport({listenPort: 1236, useNatTraversal: false});
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

    it('should MAP address', async function() {
        this.timeout(5000);
        const mappedAddr = '1.2.3.4';
        const endpoint = new factory.Transport();
        endpoint._pmClient = {
            portMapping: sinon.fake.yields(null),
            externalIp: sinon.fake.yields(null, mappedAddr)
        };
        assert.equal(await endpoint._mapAddress(), mappedAddr);
    });

    it('should TIMEOUT map address', async function() {
        this.timeout(5000);
        const mappedAddr = '1.2.3.4';
        const endpoint = new factory.Transport();
        endpoint._pmClient = {
            portMapping: sinon.fake.yields('request timeout'),
            externalIp: sinon.fake.yields(null, mappedAddr)
        };
        await endpoint._mapAddress().catch(err => console.error(err));
    });

    describe('listen tests', async () => {

        it('should FAIL to listen (ip not belong to this box)', async () => {
            const endpoint = new factory.Transport({listenAddr: '8.8.8.8'});
            try {
                await endpoint.listen();
            } catch (e) {
                if (e.message.match(/address not available/)) return;
            }
            throw new Error('Unexpected success');
        });

        it('should use custom port', async () => {
            const endpoint = new factory.Transport({listenPort: 1000});

            assert.equal(endpoint._port, 1000);
        });

        it('should pass ROUTABLE IPv4 (faked)', async () => {
            const endpoint = new factory.Transport({listenAddr: '8.8.8.8'});
            endpoint._startListen = sinon.fake();
            await endpoint.listen();
        });

        it('should pass ROUTABLE IPv6 (faked)', async () => {
            const endpoint = new factory.Transport({listenAddr: '2a00:1838:37:28:8000::'});
            endpoint._startListen = sinon.fake();
            await endpoint.listen();
        });

        it('should pass NON ROUTABLE IPv6 (no NAT traversal)', async () => {
            const endpoint = new factory.Transport({listenAddr: 'fd44:c346:f8fe:d300:5145:d4fa:badb:29bd'});
            endpoint._startListen = sinon.fake();
            endpoint._mapAddress = sinon.fake();

            await endpoint.listen();
            assert.isOk(endpoint._startListen.called);
            assert.isNotOk(endpoint._mapAddress.called);
        });

        it('should pass NON ROUTABLE IPv4 (NAT traversal)', async () => {
            const endpoint = new factory.Transport({listenAddr: '192.168.1.1'});
            endpoint._startListen = sinon.fake();
            endpoint._mapAddress = sinon.fake.rejects('timeout');

            await endpoint.listen();
            assert.isOk(endpoint._startListen.called);
            assert.isOk(endpoint._mapAddress.called);
        });

        it('should AUTODETECT ROUTABLE IPv6 address (faked)', async () => {
            const endpoint = new factory.Transport();
            endpoint.constructor = {
                getInterfacesIpV6Addresses: _ => ['2a00:1838:37:28:8000::'],
                isRoutableAddress: _ => true,
                isRoutableIpV6Address: _ => true
            };
            endpoint._startListen = sinon.fake();
            endpoint._mapAddress = sinon.fake();

            await endpoint.listen();
            assert.isOk(endpoint._startListen.called);
            assert.isNotOk(endpoint._mapAddress.called);
        });

        it('should AUTODETECT ROUTABLE IPv4 address (faked)', async () => {
            const endpoint = new factory.Transport();
            endpoint.constructor = {
                getInterfacesIpV4Addresses: _ => ['8.8.8.8'],
                getInterfacesIpV6Addresses: _ => [],
                isRoutableAddress: _ => true,
                isRoutableIpV4Address: _ => true
            };
            endpoint._startListen = sinon.fake();
            endpoint._mapAddress = sinon.fake();

            await endpoint.listen();
            assert.isOk(endpoint._startListen.called);
            assert.isNotOk(endpoint._mapAddress.called);
        });

        it('should AUTODETECT NON-ROUTABLE IPv4 & IPv6 addresses (faked)', async () => {
            const mappedAddr = '1.2.3.4';
            const endpoint = new factory.Transport();
            endpoint.constructor = {
                getInterfacesIpV4Addresses: _ => ['192.168.1.2'],
                getInterfacesIpV6Addresses: _ => ['fd44:c346:f8fe:d300:5145:d4fa:badb:29bd'],
                isRoutableAddress: _ => false,
                isRoutableIpV6Address: _ => false,
                isRoutableIpV4Address: _ => false
            };
            endpoint._startListen = sinon.fake();
            endpoint._mapAddress = sinon.fake.resolves(mappedAddr);

            await endpoint.listen();
            assert.isOk(endpoint._startListen.called);

            // selected IPv4 & portmapping called!
            assert.isOk(endpoint._mapAddress.called);

            assert.equal(endpoint.myAddress, endpoint.listenAddress);
        });

        it('should request MAPPING', async () => {
            const mappedAddr = '1.2.4.5';
            const endpoint = new factory.Transport({listenAddr: '192.168.1.1'});
            endpoint._startListen = sinon.fake();
            endpoint._pmClient = {
                portMapping: sinon.fake.yields(null),
                externalIp: sinon.fake.yields(null, mappedAddr)
            };
            await endpoint.listen();
            assert.isOk(endpoint._startListen.calledOnce);
            assert.equal(endpoint.myAddress, mappedAddr);
        });

        it('should request MAPPING and TIMEOUT', async () => {
            const intAddr = '192.168.1.1';
            const endpoint = new factory.Transport({listenAddr: intAddr});
            endpoint._startListen = sinon.fake();
            endpoint._pmClient = {
                portMapping: sinon.fake.yields('request timeout'),
                externalIp: sinon.fake.yields(null, '1.2.3.4')
            };
            await endpoint.listen();
            assert.equal(endpoint.myAddress, intAddr);
        });
    });

    it("should mark address as valid", async () => {
        assert.isOk(factory.Transport.isAddrValid('192.168.1.1'));
        assert.isOk(factory.Transport.isAddrValid('10.0.1.123'));
        assert.isOk(factory.Transport.isAddrValid('172.16.1.3'));
        assert.isOk(factory.Transport.isAddrValid('212.153.11.7'));
    });

    it("should make address as invalid", async () => {
        assert.isNotOk(factory.Transport.isAddrValid('za'));
        assert.isNotOk(factory.Transport.isAddrValid('aa'));
        assert.isNotOk(factory.Transport.isAddrValid(''));
        assert.isNotOk(factory.Transport.isAddrValid('@#$'));
    });
});
