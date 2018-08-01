const {describe, it} = require('mocha');
const {assert} = require('chai');

factory = require('./testFactory');

describe('Peer manager', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create empty PeerManager', async () => {
        const pm = new factory.PeerManager();
        assert.isOk(pm);
    });

    it('should add peer to PeerManager', async () => {
        const pm = new factory.PeerManager();
        assert.isOk(pm);
        const peer = Buffer.from('asdasd');
        pm.discoveredPeer(peer);
        const arrPeers = Array.from(pm._allPeers.keys());
        assert.isOk(arrPeers.length === 1);
        assert.isOk(peer.equals(arrPeers[0]));
    });

    it('should batchAdd peers to PeerManager', async () => {
        const pm = new factory.PeerManager();
        assert.isOk(pm);
        const peer = Buffer.from('asdasd');
        const peer2 = Buffer.from('22222');

        pm.batchDiscoveredPeers([peer, peer, peer, peer2]);
        const arrPeers = Array.from(pm._allPeers.keys());
        assert.isOk(arrPeers.length === 2);
        assert.isOk(peer.equals(arrPeers[0]));
        assert.isOk(peer2.equals(arrPeers[1]));
    });

    it('should filter peers by capability', async () => {
        const pm = new factory.PeerManager();
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
        pm.batchDiscoveredPeers([peerInfo1.encode(), peerInfo2.encode(), peerInfo3.encode(), peerInfo4.encode()]);
        const arrPeers = Array.from(pm._allPeers.keys());
        assert.isOk(arrPeers.length === 4);

        const arrWitnessNodes = pm.filterPeers({service: factory.Constants.WITNESS});
        assert.isOk(arrWitnessNodes.length === 3);
        const arrNodes = pm.filterPeers({service: factory.Constants.NODE});
        assert.isOk(arrNodes.length === 2);
    });
});
