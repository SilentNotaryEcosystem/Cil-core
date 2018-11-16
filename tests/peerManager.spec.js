'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');

const factory = require('./testFactory');
const {createDummyPeer} = require('./testUtil');

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
                sendMessage: sinon.fake()
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

    it('should get connected peers', async () => {
        const pm = new factory.PeerManager();
        for (let i = 0; i < 10; i++) {
            const peer = new factory.Peer({
                connection: {
                    remoteAddress: factory.Transport.generateAddress(),
                    listenerCount: () => 0,
                    on: () => {}
                }
            });
            pm.addPeer(peer);
        }
        const result = pm.connectedPeers();
        assert.isOk(Array.isArray(result));
        assert.equal(pm.connectedPeers().length, 10);
    });

    it('should get only TAGGED connected peers', async () => {
        const pm = new factory.PeerManager();
        for (let i = 0; i < 10; i++) {
            const peer = new factory.Peer({
                connection: {
                    remoteAddress: factory.Transport.generateAddress(),
                    listenerCount: () => 0,
                    on: () => {}
                }
            });
            if (i < 5) {
                peer.addTag('testTag');
            } else {
                peer.addTag('anotherTag');
            }
            pm.addPeer(peer);
        }

        assert.equal(pm.connectedPeers('testTag').length, 5);
        assert.equal(pm.connectedPeers('anotherTag').length, 5);
    });

    it('should REPLACE disconnected peers', async () => {
        const pm = new factory.PeerManager();

        const address = factory.Transport.generateAddress();
        const peerDisconnected = new factory.Peer({
            peerInfo: new factory.Messages.PeerInfo({
                capabilities: [
                    {service: factory.Constants.WITNESS, data: Buffer.from('pubKey')}
                ],
                address
            })
        });
        pm.addPeer(peerDisconnected);

        const peerToReplace = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE},
                {service: factory.Constants.WITNESS, data: Buffer.from('1234')}
            ],
            address
        });
        pm.addPeer(peerToReplace);

        // we replaced! not added peer
        assert.equal(pm.filterPeers().length, 1);
        const [peer] = pm.filterPeers();
        assert.equal(peer.capabilities.length, 2);
        assert.isOk(peer.isWitness);
        assert.isOk(Buffer.from('1234').equals(peer.publicKey));
    });

    it('should KEEP connected peers', async () => {
        const pm = new factory.PeerManager();
        const address = factory.Transport.generateAddress();

        const peerConnected = new factory.Peer({
            connection: {
                remoteAddress: address,
                listenerCount: () => 0,
                on: () => {}
            }
        });
        peerConnected.version = 123;
        pm.addPeer(peerConnected);

        const peerToReplace = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE},
                {service: factory.Constants.WITNESS, data: Buffer.from('1234')}
            ],
            address
        });
        pm.addPeer(peerToReplace);

        // we aren't added new peer
        assert.equal(pm.filterPeers().length, 1);
        const [peer] = pm.filterPeers();

        // peers created from connection only NODE
        assert.equal(peer.capabilities.length, 1);
        assert.isNotOk(peer.isWitness);
    });

    it('should NOT add banned peer (REJECT_BANNED)', async () => {
        const pm = new factory.PeerManager();
        const peer = new factory.Peer(createDummyPeer(factory));

        const result = pm.addPeer(peer);
        assert.isOk(result instanceof factory.Peer);
        {
            peer.ban();
            const result = pm.addPeer(peer);
            assert.isNotOk(result instanceof factory.Peer);
            assert.equal(result, factory.Constants.REJECT_BANNED);
        }
    });
    it('should NOT add peer with banned address (REJECT_BANNEDADDRESS)', async () => {
        const address = factory.Transport.generateAddress();
        const pm = new factory.PeerManager();
        const peer = new factory.Peer(createDummyPeer(factory));
        peer._peerInfo.address = address;

        let result = pm.addPeer(peer);

        assert.isOk(result instanceof factory.Peer);

        peer._lastDisconnectedAddress = address;
        peer._lastDiconnectionTime = Date.now();

        result = pm.addPeer(peer);

        assert.isNotOk(result instanceof factory.Peer);
        assert.equal(result, factory.Constants.REJECT_BANNEDADDRESS);
    });

});
