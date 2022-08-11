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

    it('should omit dead peers', async () => {
        const pm = new factory.PeerManager();

        const address = factory.Transport.strToAddress(factory.Transport.generateAddress());
        const newPeer = new factory.Peer({
            peerInfo: new factory.Messages.PeerInfo({
                capabilities: [
                    {service: factory.Constants.NODE, data: null}
                ],
                address
            })
        });
        await pm.addPeer(newPeer);

        assert.equal(pm.filterPeers(undefined, true).length, 1);
        // set counter to a dead state
        newPeer._peerInfo.failedConnectionCount = factory.Constants.PEER_FAILED_CONNECTIONS_LIMIT + 1;
        assert.equal(pm.filterPeers(undefined, true).length, 0);
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

    it('should reset attemts to connect to peer counter if node established an incoming connection', async () => {
        const pm = new factory.PeerManager();
        const peer = new factory.Peer(createDummyPeer(factory));
        peer._peerInfo.failedConnectionCount = factory.Constants.PEER_FAILED_CONNECTIONS_LIMIT + 1;
        assert.isTrue(peer.isDead());

        const result = await pm.addPeer(peer);
        assert.isOk(result instanceof factory.Peer);
        {
            const newPeer = new factory.Peer(createDummyPeer(factory));
            newPeer._bInbound = true;
            await pm.addPeer(newPeer);
            assert.isFalse(newPeer.isDead());
        }
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
        peer._peerInfo.failedConnectionCount = 2;
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
        assert.equal(peer._peerInfo.failedConnectionCount, arrPeers[0].peerInfo.failedConnectionCount);
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

        pm.associatePeer(peer, createDummyPeer(factory).peerInfo);

        assert.equal(pm._mapCandidatePeers.size, 0);
        assert.isOk(pm.addPeer.calledOnce);
    });

    it('should getConnectedPeers (incoming connection)', async () => {
        const storage = new factory.Storage({});
        const pm = new factory.PeerManager({storage});

        const connection = {
            remoteAddress: () => 'edaa',
            listenerCount: () => 1
        };
        const peer = new factory.Peer({connection});
        pm.addPeer(peer, true);

        const arrPeers = pm.getConnectedPeers(undefined);

        assert.isOk(arrPeers);
        assert.equal(arrPeers.length, 1);
    });

    describe('Whitelisted', async () => {
        let pm;
        let storage;
        beforeEach(() => {
            storage = new factory.Storage({});
            pm = new factory.PeerManager({storage});
        });

        it('should prepare internal whitelist', async () => {
            pm._prepareWhitelisted(['172.16.0.3', '172.16.0.0/16']);

            assert.isOk(pm._arrWhitelistedNets.length === 2);
            assert.isOk(pm._arrWhitelistedNets[0][1] === 128);
            assert.isOk(pm._arrWhitelistedNets[1][1] === 112);
        });

        it('should create it at constructor', async () => {
            pm = new factory.PeerManager({storage, whitelistedAddr: ['172.16.0.3', '172.16.0.0/16']});

            assert.isOk(pm._arrWhitelistedNets.length === 2);
            assert.isOk(pm._arrWhitelistedNets[0][1] === 128);
            assert.isOk(pm._arrWhitelistedNets[1][1] === 112);
        });

        it('should NOT be whitelisted (net config)', async () => {
            pm = new factory.PeerManager({storage, whitelistedAddr: ['172.16.0.0/16']});

            assert.isNotOk(pm.isWhitelisted('172.17.0.3'));
        });

        it('should NOT be whitelisted (host config) ', async () => {
            pm = new factory.PeerManager({storage, whitelistedAddr: ['172.16.0.3']});

            assert.isNotOk(pm.isWhitelisted('172.17.0.3'));
        });

        it('should add whitelisted net', async () => {
            pm = new factory.PeerManager({storage, whitelistedAddr: ['172.16.0.0/16']});

            assert.isOk(pm.isWhitelisted('172.16.0.3'));
        });

        it('should add whitelisted host (match against ipv6)', async () => {
            pm = new factory.PeerManager({storage, whitelistedAddr: ['5.101.122.167']});

            assert.isNotOk(pm.isWhitelisted('2002:565:7aa7::565:7aa7'));
        });

        it('should add whitelisted host', async () => {
            pm = new factory.PeerManager({storage, whitelistedAddr: ['172.16.0.3']});

            assert.isOk(pm.isWhitelisted('172.16.0.3'));
        });

        it('should add peer and mark it as whitelisted', async () => {
            pm = new factory.PeerManager({storage, whitelistedAddr: ['172.16.0.0/16']});
            const fakeConnection = {
                remoteAddress: '172.16.5.7',
                remotePort: 872,
                listenerCount: sinon.fake.returns(1)
            };
            const peer = new factory.Peer({connection: fakeConnection});

            // fake it, because of testTransport
            sinon.stub(peer, 'address').get(() => '172.16.5.7');

            pm.addPeer(peer);
            assert.isOk(peer.isWhitelisted());
        });
    });

    describe('broadcastToConnected', async () => {
        let pm;
        let storage;
        let fakePeers;
        beforeEach(() => {
            storage = new factory.Storage({});
            pm = new factory.PeerManager({storage});
            fakePeers = [];

            for (let i = 0; i < 5; i++) {
                fakePeers.push({
                    pushMessage: sinon.fake.resolves(),
                    address: factory.Transport.generateAddress()
                });
            }
            pm.getConnectedPeers = sinon.fake.returns(fakePeers);
        });

        it('should send to all peers (no count, no peer to exclude)', async () => {
            const fakeMessage = {payload: Buffer.from('fakemessagecontent')};
            pm.broadcastToConnected(undefined, fakeMessage);

            assert.isOk(fakePeers.every(p => p.pushMessage.calledOnce));
        });

        it('should send to all peers (empty message payload)', async () => {
            const fakeMessage = {payload: []};
            pm.broadcastToConnected(undefined, fakeMessage);

            assert.isOk(fakePeers.every(p => p.pushMessage.calledOnce));
        });

        it('should send only to 2 neighbours', async () => {
            const fakeMessage = {payload: Buffer.from('fakemessagecontent')};
            pm.broadcastToConnected(undefined, fakeMessage, undefined, 2);

            assert.equal(fakePeers.filter(p => p.pushMessage.calledOnce).length, 2);
        });

        it('should send to all peers except specified', async () => {
            const fakeMessage = {payload: Buffer.from('fakemessagecontent')};
            pm.broadcastToConnected(undefined, fakeMessage, fakePeers[0]);

            const arrInformedPeers = fakePeers.filter(p => p.pushMessage.calledOnce);
            assert.equal(arrInformedPeers.length, fakePeers.length - 1);
            assert.isOk(arrInformedPeers.every(p => p.address !== fakePeers[0].address));
        });

        it('should send only to 2 except specified', async () => {
            const fakeMessage = {payload: Buffer.from('fakemessagecontent')};
            pm.broadcastToConnected(undefined, fakeMessage, fakePeers[0], 2);

            const arrInformedPeers = fakePeers.filter(p => p.pushMessage.calledOnce);
            assert.equal(arrInformedPeers.length, 2);
            assert.isOk(arrInformedPeers.every(p => p.address !== fakePeers[0].address));
        });

        it('should send to all (connected peers less than needed)', async () => {
            const fakeMessage = {payload: Buffer.from('fakemessagecontent')};
            pm.broadcastToConnected(undefined, fakeMessage, undefined, 8);

            assert.equal(fakePeers.filter(p => p.pushMessage.calledOnce).length, fakePeers.length);
        });

    });
});
