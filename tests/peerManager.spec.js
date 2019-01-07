'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');
const {sleep} = require('../utils');

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
            address: factory.Transport.strToAddress(factory.Transport.generateAddress()),
            port: 123
        });
        await pm.addPeer(peer);
        const arrPeers = Array.from(pm._allPeers.keys());
        assert.isOk(arrPeers.length === 1);
        assert.equal(arrPeers[0], pm._createKey(factory.Transport.addressToString(peer.address), peer.port));
    });

    it('should add peer to PeerManager from Connection', async () => {
        const pm = new factory.PeerManager();
        assert.isOk(pm);
        const peer = new factory.Peer({
            connection: {
                remoteAddress: factory.Transport.generateAddress(),
                remotePort: 123,
                listenerCount: () => 0,
                on: () => {},
                sendMessage: sinon.fake()
            }
        });
        await pm.addPeer(peer);
        const arrPeers = Array.from(pm._allPeers.keys());
        assert.isOk(arrPeers.length === 1);
        assert.equal(arrPeers[0], pm._createKey(peer.address, peer.port));
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
        for (let peerInfo of [peerInfo1, peerInfo2, peerInfo3, peerInfo4]) {
            await pm.addPeer(peerInfo)
        };
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
        await pm.addPeer(peer);
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

    it('should keep only one peer in array', async function() {
        const pm = new factory.PeerManager();
        assert.isOk(pm);
        const peer = new factory.Peer({
            connection: {
                remoteAddress: factory.Transport.generateAddress(),
                listenerCount: () => 0,
                on: () => {}
            }
        });
        await pm.addPeer(peer);
        await pm.addPeer(peer);
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
            await pm.addPeer(peer);
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
            await pm.addPeer(peer);
        }

        assert.equal(pm.connectedPeers('testTag').length, 5);
        assert.equal(pm.connectedPeers('anotherTag').length, 5);
    });

    it('should REPLACE disconnected peers', async () => {
        const pm = new factory.PeerManager();

        const address = factory.Transport.strToAddress(factory.Transport.generateAddress());
        const peerDisconnected = new factory.Peer({
            peerInfo: new factory.Messages.PeerInfo({
                capabilities: [
                    {service: factory.Constants.WITNESS, data: Buffer.from('pubKey')}
                ],
                address
            })
        });
        await pm.addPeer(peerDisconnected);

        const peerToReplace = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE},
                {service: factory.Constants.WITNESS, data: Buffer.from('1234')}
            ],
            address
        });
        await pm.addPeer(peerToReplace);

        // we replaced! not added peer
        assert.equal(pm.filterPeers().length, 1);
        const [peer] = pm.filterPeers();
        assert.equal(peer.capabilities.length, 2);
        assert.isOk(peer.isWitness);
        assert.isOk(Buffer.from('1234').equals(peer.publicKey));
    });

    it('should KEEP connected peers', async () => {
        const pm = new factory.PeerManager();
        const address = factory.Transport.strToAddress(factory.Transport.generateAddress());

        const peerConnected = new factory.Peer({
            connection: {
                remoteAddress: address,
                listenerCount: () => 0,
                on: () => {}
            }
        });
        peerConnected.version = 123;
        await pm.addPeer(peerConnected);

        const peerToReplace = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE},
                {service: factory.Constants.WITNESS, data: Buffer.from('1234')}
            ],
            address
        });
        await pm.addPeer(peerToReplace);

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

        const result = await pm.addPeer(peer);
        assert.isOk(result instanceof factory.Peer);
        {
            peer.ban();
            const result = await pm.addPeer(peer);
            assert.isNotOk(result instanceof factory.Peer);
            assert.equal(result, factory.Constants.REJECT_BANNED);
        }
    });
    it('should NOT add peer with banned address (REJECT_BANNEDADDRESS)', async () => {
//        const address = factory.Transport.strToAddress(factory.Transport.generateAddress());
        const address = factory.Transport.generateAddress();
        const pm = new factory.PeerManager();
        const peer = new factory.Peer(createDummyPeer(factory));
        peer._peerInfo.address = factory.Transport.strToAddress(address);

        let result = await pm.addPeer(peer);

        assert.isOk(result instanceof factory.Peer);

        peer._lastDisconnectedAddress = address;
        peer._lastDisconnectionTime = Date.now();

        result = await pm.addPeer(peer);

        assert.isNotOk(result instanceof factory.Peer);
        assert.equal(result, factory.Constants.REJECT_BANNEDADDRESS);
    });

    it('should save and restore peer ', async () => {
        const storage = new factory.Storage({});
        const pm = new factory.PeerManager({storage});
        assert.isOk(pm);
        const peerInfo = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null},
                {service: factory.Constants.WITNESS, data: Buffer.from('asdasdasd')}
            ],
            address: factory.Transport.strToAddress(factory.Transport.generateAddress())
        });
        const peer = new factory.Peer({peerInfo});

        peer._transmittedBytes = 250;
        peer._receivedBytes = 400;
        peer.misbehave(10);
        await pm.savePeers([peer]);

        let newPeer = await pm.getPeer(peer.address);
        
        assert.deepEqual(peer.address, newPeer.address);
        assert.equal(peer.capabilities.length, newPeer.capabilities.length);
        assert.equal(peer.capabilities[0].service, newPeer.capabilities[0].service);
        assert.deepEqual( newPeer.capabilities[0].data, [])

        assert.equal(peer.capabilities[1].service, newPeer.capabilities[1].service)
        assert.deepEqual(peer.capabilities[1].data, newPeer.capabilities[1].data);

        assert.equal(peer.missbehaveScore, newPeer.peerInfo.lifetimeMisbehaveScore);
        assert.equal(peer.transmittedBytes, newPeer.peerInfo.lifetimeTransmittedBytes);
        assert.equal(peer.receivedBytes, newPeer.peerInfo.lifetimeReceivedBytes);
        
    });

    it('should load peers from storage', async () => {
        const storage = new factory.Storage({});

        const pm = new factory.PeerManager({storage});
        assert.isOk(pm);
        const address = factory.Transport.strToAddress(factory.Transport.generateAddress());
        const peerInfo = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null},
                {service: factory.Constants.WITNESS, data: Buffer.from('asdasdasd')}
            ],
            address
        });
        await pm.savePeers([new factory.Peer({peerInfo})]);
        const arrPeers = await pm.loadPeers([address]);
        assert.isOk(arrPeers.length === 1);
    });

    it('should find best peers', async () => {
        const pm = new factory.PeerManager();
        for (let i = 0; i < 15; i++) {
            const peer = new factory.Peer({
                connection: {
                    remoteAddress: factory.Transport.generateAddress(),
                    listenerCount: () => 0,
                    on: () => {}
                }
            });
            peer._transmittedBytes = 10 - i;
            peer._receivedBytes = 10 - i;

            peer._missbehaveScore = i;
            await pm.addPeer(peer);
        }
        const bestPeers = pm.findBestPeers();
        assert.equal(bestPeers.length, factory.Constants.MAX_PEERS);
        for (let i = 0; i < 9; i++) {
            const current = bestPeers[i].quality;
            const next = bestPeers[i + 1].quality;

            assert.isTrue(current > next);
        }
    });

   
    it('should remove peer', async () => {
        const pm = new factory.PeerManager();
        const peer = new factory.Peer(createDummyPeer(factory));

        pm.addPeer(peer);
        assert.isOk(pm.hasPeer(peer));
        pm.removePeer(peer);
        assert.isNotOk(pm.hasPeer(peer));
    });

});
