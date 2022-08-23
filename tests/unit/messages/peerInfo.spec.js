const {describe, it} = require('mocha');
const {assert} = require('chai');
const debug = require('debug')('peerInfo:');

const factory = require('../testFactory');

let templatePeer;

describe('PeerInfo Message', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();

        templatePeer = {
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
        };
    });

    after(async function () {
        this.timeout(15000);
    });

    it('should NOT create empty PeerInfo', async () => {
        try {
            new factory.Messages.PeerInfo();
            assert.isOk(false, 'Unexpected success!');
        } catch (err) {
            debug(err);
        }
    });

    it('should create PeerInfo', async () => {
        const peerInfo = new factory.Messages.PeerInfo(templatePeer);
        assert.isOk(peerInfo);
        assert.equal(peerInfo.port, templatePeer.port);
        assert.isOk(Array.isArray(peerInfo.capabilities));
        assert.equal(peerInfo.capabilities.length, templatePeer.capabilities.length);
        assert.isOk(Buffer.isBuffer(peerInfo.address));
    });

    it('should create with address from Buffer with default port', function () {
        const peerInfo = new factory.Messages.PeerInfo({
            capabilities: [{service: factory.Constants.NODE}],
            address: factory.Transport.strToAddress(factory.Transport.generateAddress())
        });
        assert.equal(peerInfo.port, factory.Constants.port);
        assert.isOk(Array.isArray(peerInfo.capabilities));
        assert.isOk(Buffer.isBuffer(peerInfo.address));
    });

    it('tests getters/setters', async () => {
        const peerInfo = new factory.Messages.PeerInfo(templatePeer);

        assert.equal(peerInfo.port, 12345);
        const buffAddr = peerInfo.address;
        assert.isOk(Buffer.isBuffer(buffAddr));

        const addrRaw = peerInfo.data.address;
        assert.isOk(addrRaw);
        assert.deepEqual(addrRaw, templatePeer.address);

        peerInfo.address = buffAddr;
        assert.isOk(peerInfo.address);
        assert.isOk(Buffer.isBuffer(peerInfo.address));
        assert.deepEqual(peerInfo.data.address, templatePeer.address);
    });

    it('should transform addreess to buffer and back', async () => {
        const addr = {
            addr0: 0x2001,
            addr1: 0xdb8,
            addr2: 0x1234,
            addr3: 0x3
        };
        const buff = factory.Messages.PeerInfo.toAddress(addr);
        assert.isOk(buff && Buffer.isBuffer(buff));
        const objRevertedAddr = factory.Messages.PeerInfo.fromAddress(buff);
        assert.deepEqual(addr, objRevertedAddr);
    });

    it('should add capability', async () => {
        const peerInfo = new factory.Messages.PeerInfo(templatePeer);
        peerInfo.addCapability({service: factory.Constants.WITNESS, data: Buffer.from('123')});
        assert.isOk(Array.isArray(peerInfo.capabilities));
        assert.equal(peerInfo.capabilities.length, 3);
    });
});
