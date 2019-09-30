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
        const arrPeers = Array.from(pm._mapAllPeers.keys());
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
        const arrPeers = Array.from(pm._mapAllPeers.keys());
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
            await pm.addPeer(peerInfo);
        }
        ;
        const arrPeers = Array.from(pm._mapAllPeers.keys());
        assert.isOk(arrPeers.length === 4);

        const arrWitnessNodes = pm.filterPeers({service: factory.Constants.WITNESS}, true);
        assert.isOk(arrWitnessNodes.length === 3);
        arrWitnessNodes.forEach(peer => {
            assert.isOk(peer && peer.capabilities && peer.address && peer.port);
        });
        const arrNodes = pm.filterPeers({service: factory.Constants.NODE}, true);
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
        const arrPeers = Array.from(pm._mapAllPeers.keys());
        assert.isOk(Array.isArray(arrPeers));
        assert.equal(arrPeers.length, 1);
    });

    it('should check what is the new peer is whitelisted', async function() {
        const pm = new factory.PeerManager();
        assert.isOk(pm);
        const peer = new factory.Peer({
            connection: {
                remoteAddress: factory.Transport.generateAddress(),
                listenerCount: () => 0,
                on: () => {}
            }
        });
        pm.addPeerToWhiteList(peer.address);
        const whitelisted = pm.isWhitelistedAddress(peer.address);
        assert.isOk(whitelisted);
        await peer.connect();
        peer.markAsPersistent();
        assert.isOk(peer.isPersistent());
    });

    it('should check what is the new peer is not whitelisted', async function() {
        const pm = new factory.PeerManager();
        const whitelisted = pm.isWhitelistedAddress(factory.Transport.generateAddress());
        assert.isNotOk(whitelisted);
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
        const result = pm.getConnectedPeers();
        assert.isOk(Array.isArray(result));
        assert.equal(pm.getConnectedPeers().length, 10);
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

        assert.equal(pm.getConnectedPeers('testTag').length, 5);
        assert.equal(pm.getConnectedPeers('anotherTag').length, 5);
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
                {service: factory.Constants.WITNESS, data: Buffer.from('1234', 'hex')}
            ],
            address
        });
        await pm.addPeer(peerToReplace, true);

        // we replace! not added peer
        assert.equal(pm.filterPeers(undefined, true).length, 1);
        const [peer] = pm.filterPeers(undefined, true);
        assert.equal(peer.capabilities.length, 2);
        assert.isOk(peer.isWitness);
        assert.isOk(peer.witnessAddress.toString() === '1234');
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
        assert.equal(pm.filterPeers(undefined, true).length, 1);
        const [peer] = pm.filterPeers(undefined, true);

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
    it('should NOT add peer with banned address (REJECT_RESTRICTED)', async () => {
        const address = factory.Transport.generateAddress();
        const pm = new factory.PeerManager();
        const peer = new factory.Peer(createDummyPeer(factory));
        peer._peerInfo.address = factory.Transport.strToAddress(address);

        let result = await pm.addPeer(peer);

        assert.isOk(result instanceof factory.Peer);

        peer._restrictedTill = Date.now() + 3000;

        result = await pm.addPeer(peer);

        assert.isNotOk(result instanceof factory.Peer);
        assert.equal(result, factory.Constants.REJECT_RESTRICTED);
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

        peer._updateTransmitted(250);
        peer._updateReceived(400);
        peer.misbehave(10);
        await pm.savePeers([peer]);

        let arrPeers = await pm.loadPeers();
        assert.isOk(arrPeers.length === 1);
        assert.deepEqual(peer.address, arrPeers[0].address);
        assert.equal(peer.capabilities.length, arrPeers[0].capabilities.length);
        assert.equal(peer.capabilities[0].service, arrPeers[0].capabilities[0].service);
        assert.deepEqual(arrPeers[0].capabilities[0].data, []);

        assert.equal(peer.capabilities[1].service, arrPeers[0].capabilities[1].service);
        assert.deepEqual(peer.capabilities[1].data, arrPeers[0].capabilities[1].data);

        assert.equal(peer.misbehaveScore, arrPeers[0].peerInfo.lifetimeMisbehaveScore);
        assert.equal(peer.transmittedBytes, arrPeers[0].peerInfo.lifetimeTransmittedBytes);
        assert.equal(peer.receivedBytes, arrPeers[0].peerInfo.lifetimeReceivedBytes);

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
        const arrPeers = await pm.loadPeers();
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

            peer._misbehaveScore = i;
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

    it('should save all peer', async () => {
        const storage = new factory.Storage({});

        const pm = new factory.PeerManager({storage});
        let peerInfos = [];
        peerInfos[0] = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null},
                {service: factory.Constants.WITNESS, data: Buffer.from('asdasdasd')}
            ],
            address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x3}
        });
        peerInfos[1] = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null}
            ],
            address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x4}
        });

        pm.addPeer(peerInfos[0]);
        pm.addPeer(peerInfos[1]);
        await pm.saveAllPeers();
        const arrPeers = await pm.loadPeers();

        assert.isOk(arrPeers.length === 2);

    });

    it('should addCandidateConnection', async () => {
        const storage = new factory.Storage({});
        const pm = new factory.PeerManager({storage});

        const connection = {
            remoteAddress: () => 'edaa',
            listenerCount: () => 1
        };
        pm.addCandidateConnection(connection);
    });

    it('should addCandidateConnection', async () => {
        const storage = new factory.Storage({});
        const pm = new factory.PeerManager({storage});

        const connection = {
            remoteAddress: () => 'edaa',
            listenerCount: () => 1
        };
        pm.addCandidateConnection(connection);

        assert.equal(pm._mapCandidatePeers.size, 1);
    });

    it('should associatePeer', async () => {
        const storage = new factory.Storage({});
        const pm = new factory.PeerManager({storage});

        const connection = {
            remoteAddress: () => 'edaa',
            listenerCount: () => 1
        };
        pm.addCandidateConnection(connection);
        const peer = new factory.Peer({connection});
        pm.addPeer = sinon.fake();

        pm.associatePeer(peer, createDummyPeer(factory));

        assert.equal(pm._mapCandidatePeers.size, 0);
        assert.isOk(pm.addPeer.calledOnce);
    });

    it('it should be a limit of MAX_PEERS / 2 for incoming connection', async () => {
        const pm = new factory.PeerManager();
        // incoming connections is 50% of all connections
        const nMaxIncomingConnections = factory.Constants.MAX_PEERS / 2;
        for (let i = 0; i < nMaxIncomingConnections + 1000; i++) {
            const peer = new factory.Peer({
                connection: {
                    remoteAddress: factory.Transport.generateAddress(),
                    listenerCount: () => 0,
                    on: () => {}
                }
            });
            if (i < nMaxIncomingConnections) {
                await pm.addPeer(peer);
            }
        }
        const arrPeers = pm.getConnectedPeers(undefined);
        assert.equal(arrPeers.length, nMaxIncomingConnections);
    });
});
