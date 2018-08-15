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

    it('should add peer to PeerManager from PeerInfo', async () => {
        const pm = new factory.PeerManager();
        assert.isOk(pm);
        const peer = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null},
                {service: factory.Constants.WITNESS, data: Buffer.from('asdasdasd')}
            ],
            address: factory.Transport.generateAddress()
        });
        pm.addPeer(peer);
        const arrPeers = Array.from(pm._allPeers.keys());
        assert.isOk(arrPeers.length === 1);
        assert.isOk(peer.address.equals(Buffer.from(arrPeers[0], 'hex')));
    });

    it('should add peer to PeerManager from Connection', async () => {
        const pm = new factory.PeerManager();
        assert.isOk(pm);
        const peer = new factory.Peer({
            connection: {
                remoteAddress: factory.Transport.generateAddress(),
                listenerCount: () => 0,
                on: () => {},
                sendMessage: async (msgAddr) => {
                    msg = msgAddr;
                }
            }
        });
        pm.addPeer(peer);
        const arrPeers = Array.from(pm._allPeers.keys());
        assert.isOk(arrPeers.length === 1);
        assert.isOk(peer.address.equals(Buffer.from(arrPeers[0], 'hex')));
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
            address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x4}
        });
        const peerInfo3 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.WITNESS, data: Buffer.from('1111')}
            ],
            address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x5}
        });
        const peerInfo4 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.WITNESS, data: Buffer.from('2222')}
            ],
            address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x6}
        });
        [peerInfo1, peerInfo2, peerInfo3, peerInfo4].forEach(peerInfo => pm.addPeer(peerInfo));
        const arrPeers = Array.from(pm._allPeers.keys());
        assert.isOk(arrPeers.length === 4);

        const arrWitnessNodes = pm.filterPeers({service: factory.Constants.WITNESS});
        assert.isOk(arrWitnessNodes.length === 3);
        arrWitnessNodes.forEach(peer => {
            assert.isOk(peer && peer.capabilities && peer.address && peer.port);
        });
        const arrNodes = pm.filterPeers({service: factory.Constants.NODE});
        assert.isOk(arrNodes.length === 2);
        arrWitnessNodes.forEach(peerInfo => {
            assert.isOk(peerInfo && peerInfo.capabilities && peerInfo.address && peerInfo.port);
        });
    });

    it('should emit EMPTY message (WRONG public key)', async () => {
        const pm = new factory.PeerManager();
        const pubKey = '03ee7b7818bdc27be0030c2edf44ec1cce20c1f7561fc8412e467320b77e20f716';
        const peer = new factory.Peer({
            peerInfo: new factory.Messages.PeerInfo({
                capabilities: [
                    {service: factory.Constants.WITNESS, data: Buffer.from(pubKey, 'hex')}
                ],
                address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x5}
            })
        });
        pm.addPeer(peer);
        const keyPair = factory.Crypto.createKeyPair();
        const message = new factory.Messages.MsgVersion({nonce: 12});
        message.encode();
        message.sign(keyPair.getPrivate());
        assert.isOk(message.signature);

        // should be replaced with undefined
        let msgEmitted = 'dummy';
        pm.on('witnessMessage', (thisPeer, msg) => {
            msgEmitted = msg;
        });
        pm._incomingMessage(peer, message);
        assert.isNotOk(msgEmitted);
    });

    it('should emit GOOD message (GOOD signature)', async () => {
        const keyPair = factory.Crypto.createKeyPair();
        const pm = new factory.PeerManager();
        const peer = new factory.Peer({
            peerInfo: new factory.Messages.PeerInfo({
                capabilities: [
                    {service: factory.Constants.WITNESS, data: Buffer.from(keyPair.getPublic(), 'hex')}
                ],
                address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x5}
            })
        });
        pm.addPeer(peer);
        const message = new factory.Messages.MsgVersion({nonce: 12});
        message.sign(keyPair.getPrivate());
        assert.isOk(message.signature);

        // should be replaced with undefined
        let msgEmitted = 'dummy';
        pm.on('witnessMessage', (thisPeer, msg) => {
            msgEmitted = msg;
        });
        pm._incomingMessage(peer, message);
        assert.isOk(msgEmitted);
        assert.equal(msgEmitted, message);
    });

    it('should keep only one peer in array', function() {
        const pm = new factory.PeerManager();
        assert.isOk(pm);
        const peer = new factory.Peer({
            connection: {
                remoteAddress: factory.Transport.generateAddress(),
                listenerCount: () => 0,
                on: () => {}
            }
        });
        pm.addPeer(peer);
        pm.addPeer(peer);
        const arrPeers = Array.from(pm._allPeers.keys());
        assert.isOk(Array.isArray(arrPeers));
        assert.equal(arrPeers.length, 1);
    });
});
