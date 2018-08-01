const {describe, it} = require('mocha');
const {assert} = require('chai');

factory = require('./testFactory');

describe('Node tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create a Node', async () => {
        const node = new factory.Node({});
        assert.isOk(node);
    });

    it('should resolve DNS seeds', async () => {
        const node = new factory.Node({arrDnsSeeds: ['a:b', 'c:d']});
        assert.isOk(node);
        const arrAddresses = await node._queryDnsRecords(['a:b', 'c:d']);
        assert.deepEqual(arrAddresses, ['a', 'b', 'c', 'd']);
    });

    it('should merge seeds', async () => {
        const node = new factory.Node({arrDnsSeeds: ['a:b', 'c:d'], arrSeedAddresses: ['e', 'f']});
        assert.isOk(node);
        await node._mergeSeedPeers();
        assert.deepEqual(node._arrSeedAddresses, ['e', 'f', 'a', 'b', 'c', 'd']);
    });

    it('should prepare verAckMessage', async () => {
        const node = new factory.Node({});
        const inMsg = new factory.Messages.MsgVersion({});
        const msg = node._handleVersionMessage(inMsg);
        assert.isOk(msg && msg.isVerAck());
    });

    it('should prepare MsgAddr', async () => {
        const node = new factory.Node({});
        const peerInfo1 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null},
                {service: factory.Constants.WITNESS, data: Buffer.from('asdasdasd')}
            ],
            address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x3}
        });
        const peerInfo2 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null}
            ],
            address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x3}
        });
        const peerInfo3 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.WITNESS, data: Buffer.from('1111')}
            ],
            address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x3}
        });
        const peerInfo4 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.WITNESS, data: Buffer.from('2222')}
            ],
            address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x3}
        });
        node._peerManager.batchDiscoveredPeers(
            [peerInfo1.encode(), peerInfo2.encode(), peerInfo3.encode(), peerInfo4.encode()]);

        const msg = node._handleAddrMessage();
        assert.isOk(msg && msg.isAddr());
        assert.isOk(msg.peers);
        assert.equal(msg.peers.length, 4);
    });

});
