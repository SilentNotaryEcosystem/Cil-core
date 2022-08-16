const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');
const debug = require('debug')('peer:');

const {sleep} = require('../utils');
const {createDummyPeer} = require('./testUtil');

const factory = require('./testFactory');

let peerInfo;
let address;
let fakeNode;
let newPeer;

describe('Peer tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
        address = factory.Transport.generateAddress();

        const keyPair = factory.Crypto.createKeyPair();

        peerInfo = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null},
                {service: factory.Constants.WITNESS, data: Buffer.from(keyPair.address, 'hex')}
            ],
            address: factory.Transport.strToAddress(address),
            port: 12345
        });

        fakeNode = new factory.Transport({delay: 0, listenAddr: address});
        fakeNode.listen();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should NOT create peer without connection or PeerInfo', async () => {
        const wrapper = () => new factory.Peer();
        assert.throws(wrapper);
    });

    it('should create from connection', async () => {
        const newPeer = new factory.Peer({
            connection: {
                on: () => {},
                listenerCount: () => 0,
                close: () => {},
                remoteAddress: factory.Transport.generateAddress()
            }
        });
        assert.isOk(newPeer);
        assert.isNotOk(newPeer.disconnected);
    });

    it('should create from peerInfo', async () => {
        const newPeer = new factory.Peer({peerInfo});
        assert.isOk(newPeer);
    });

    it('should connect', async () => {
        newPeer = new factory.Peer({peerInfo});
        assert.isOk(newPeer);

        await newPeer.connect();
        assert.isNotOk(newPeer.disconnected);
        assert.isOk(newPeer._connection);
    });

    it('should emit message upon incoming connection', (done) => {
        newPeer = new factory.Peer({peerInfo});
        assert.isOk(newPeer);

        newPeer.connect().then(() => {
            newPeer.on('message', (peer, msg) => done());
            newPeer._connection.emit('message', {isInv: () => false});
        });
    });

    it('should queue and send messages', async function() {
        this.timeout(5000);
        let nSendMessages = 0;
        const delay = 200;
        const newPeer = new factory.Peer({
            connection: {
                remoteAddress: factory.Transport.strToAddress(factory.Transport.generateAddress()),
                listenerCount: () => 0,
                on: () => {},
                sendMessage: async () => {

                    // emulate network latency
                    await sleep(delay);
                    nSendMessages++;
                },
                close: () => {}
            }
        });
        for (let i = 0; i < 5; i++) {
            newPeer.pushMessage({message: `testMessage${i}`, isGetBlocks: () => false});
        }
        await sleep(delay * 6);
        assert.equal(nSendMessages, 5);
    });

    it('should NOT ban peer', async () => {
        const newPeer = new factory.Peer({
            connection: {
                listenerCount: () => 0,
                on: () => {},
                close: () => {},
                remoteAddress: factory.Transport.generateAddress()
            }
        });
        assert.isOk(newPeer);
        newPeer.misbehave(1);
        assert.isNotOk(newPeer.isBanned());
        newPeer.misbehave(10);
        assert.isNotOk(newPeer.isBanned());
    });

    it('should ban peer', async () => {
        const newPeer = new factory.Peer({
            connection: {
                listenerCount: () => 0,
                on: () => {}, close: () => {},
                remoteAddress: factory.Transport.generateAddress()
            }
        });
        assert.isOk(newPeer);
        newPeer.misbehave(1);
        assert.isNotOk(newPeer.isBanned());
        newPeer.misbehave(factory.Constants.BAN_PEER_SCORE);
        assert.isOk(newPeer.isBanned());
    });

    it('should get peer witnessAddress', async () => {
        const newPeer = new factory.Peer({
            peerInfo: {
                capabilities: [
                    {service: factory.Constants.WITNESS, data: Buffer.from('1111', 'hex')}
                ],
                address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x5}
            }
        });
        assert.isOk(newPeer);
        assert.isOk(newPeer.witnessAddress);
        assert.equal(newPeer.witnessAddress, '1111');
    });

    it('should emit empty "witnessMessage" (wrong signature)', async () => {
        const keyPair = factory.Crypto.createKeyPair();

        // create message and sign it with key that doesn't belong to our concilium
        const msg = new factory.Messages.MsgWitnessCommon({conciliumId: 0});
        msg.handshakeMessage = true;
        msg.sign(keyPair.getPrivate());

        const witnessMessageSpy = sinon.fake();
        const messageSpy = sinon.fake();
        const newPeer = new factory.Peer({peerInfo});
        await newPeer.connect();
        newPeer.on('witnessMessage', witnessMessageSpy);
        newPeer.on('message', messageSpy);
        newPeer._connection.emit('message', msg);

        assert.isOk(witnessMessageSpy.calledOnce);
        assert.isNotOk(messageSpy.called);
    });

    it('should unban peer after BAN_PEER_TIME', async function() {
        const newPeer = new factory.Peer({peerInfo: createDummyPeer(factory)});
        newPeer.ban();
        assert.isOk(newPeer.isBanned());
        newPeer._bannedTill = Date.now();
        assert.isNotOk(newPeer.isBanned());
    });

    it('should not unban peer before BAN_PEER_TIME', async function() {
        const newPeer = new factory.Peer({peerInfo: createDummyPeer(factory)});
        newPeer.ban();
        newPeer._bannedTill = Date.now() + factory.Constants.BAN_PEER_TIME / 2;
        assert.isOk(newPeer.isBanned());
    });

    it('should disconnect after PEER_CONNECTION_LIFETIME', async function() {
        this.timeout(3000);
        const newPeer = new factory.Peer({peerInfo});

        await newPeer.connect();
        newPeer._connectedTill = Date.now() - 1;
        newPeer._tick();

        assert.isOk(newPeer.disconnected);
        assert.isNotOk(newPeer._connection);

    });

    it('should NOT disconnect PERSISTENT after PEER_CONNECTION_LIFETIME', async function() {
        this.timeout(3000);
        const newPeer = new factory.Peer({peerInfo});

        await newPeer.connect();
        newPeer.markAsPersistent();
        newPeer._connectedTill =
            new Date(newPeer._connectedTill.getTime() - factory.Constants.PEER_CONNECTION_LIFETIME);

        await sleep(1500);

        assert.isNotOk(newPeer.disconnected);
    });

    it('should disconnect peer when more than PEER_MAX_BYTESCOUNT bytes received', async () => {
        newPeer = new factory.Peer({peerInfo});
        const msg = new factory.Messages.MsgCommon();
        msg.payload = Buffer.alloc(factory.Constants.PEER_MAX_BYTES_COUNT - 1);
        await newPeer.connect();
        newPeer._connection.emit('message', msg);

        assert.isNotOk(newPeer.disconnected);
        assert.isOk(newPeer._connection);
        assert.isOk(newPeer.amountBytes);

        newPeer._connection.emit('message', msg);

        assert.isOk(newPeer.disconnected);
        assert.isNotOk(newPeer._connection);
        assert.isNotOk(newPeer.amountBytes);

    });

    it('should NOT disconnect PERSISTENT peer when more than PEER_MAX_BYTESCOUNT bytes received', async () => {
        newPeer = new factory.Peer({peerInfo});
        const msg = new factory.Messages.MsgCommon();
        msg.payload = Buffer.alloc(factory.Constants.PEER_MAX_BYTES_COUNT - 1);
        await newPeer.connect();
        newPeer.markAsPersistent();
        newPeer._connection.emit('message', msg);

        assert.isNotOk(newPeer.disconnected);
        assert.isOk(newPeer._connection);
        assert.isOk(newPeer.amountBytes);

        newPeer._connection.emit('message', msg);

        assert.isNotOk(newPeer.disconnected);
    });

    it('should disconnect peer when more than PEER_MAX_BYTESCOUNT bytes transmitted', async () => {
        const msg = new factory.Messages.MsgCommon();
        msg.payload = Buffer.alloc(factory.Constants.PEER_MAX_BYTES_COUNT - 1);

        const newPeer = new factory.Peer({
            connection: {
                remoteAddress: factory.Transport.generateAddress(),
                //address: factory.Transport.strToAddress(factory.Transport.generateAddress()),
                listenerCount: () => 0,
                on: () => {},
                sendMessage: async () => {},
                close: () => {}
            }
        });
        newPeer.pushMessage(msg);
        await sleep(200);

        assert.isNotOk(newPeer.disconnected);
        assert.isOk(newPeer._connection);

        newPeer.pushMessage(msg);
        await sleep(200);

        assert.isOk(newPeer.disconnected);
        assert.isNotOk(newPeer._connection);
    });

    it('should NOT disconnect PERSISTENT peer when more than PEER_MAX_BYTESCOUNT bytes transmitted', async () => {
        const msg = new factory.Messages.MsgCommon();
        msg.payload = Buffer.alloc(factory.Constants.PEER_MAX_BYTES_COUNT - 1);

        const newPeer = new factory.Peer({
            connection: {
                remoteAddress: factory.Transport.strToAddress(factory.Transport.generateAddress()),
                address: factory.Transport.strToAddress(factory.Transport.generateAddress()),
                listenerCount: () => 0,
                on: () => {},
                sendMessage: async () => {},
                close: () => {}
            }
        });
        newPeer.markAsPersistent();
        newPeer.pushMessage(msg);
        await sleep(200);

        assert.isNotOk(newPeer.disconnected);
        assert.isOk(newPeer._connection);

        newPeer.pushMessage(msg);
        await sleep(200);

        assert.isNotOk(newPeer.disconnected);
    });

    it('should not connect peer if restricted', async () => {
        const newPeer = new factory.Peer({peerInfo});
        await newPeer.connect();
        newPeer.disconnect();
        assert.isOk(newPeer.isRestricted());
        await newPeer.connect();
        assert.isOk(newPeer.disconnected);
    });

    it('should send pong message if ping message is received', async () => {
        const newPeer = new factory.Peer({peerInfo});
        const pushMessage = sinon.fake();
        newPeer.pushMessage = pushMessage;
        const msg = new factory.Messages.MsgCommon();
        msg.pingMessage = true;

        await newPeer.connect();
        newPeer._connection.emit('message', msg);
        assert.equal(pushMessage.callCount, 1);
        const [pongMsg] = pushMessage.args[0];
        assert.isTrue(pongMsg.isPong());
    });

    it('should disconnect if peer dead', async function() {
        const newPeer = new factory.Peer({peerInfo});
        await newPeer.connect();
        newPeer._lastActionTimestamp = Date.now() - factory.Constants.PEER_DEAD_TIME - 1;
        newPeer._tick();

        assert.isOk(newPeer.disconnected);
        assert.isNotOk(newPeer._connection);
    });

    it('should not disconnect if message received', async function() {
        const newPeer = new factory.Peer({peerInfo});
        await newPeer.connect();
        newPeer._lastActionTimestamp = Date.now() - factory.Constants.PEER_DEAD_TIME - 1;

        newPeer._connection.emit('message', {isInv: () => false});
        newPeer._tick();

        assert.isNotOk(newPeer.disconnected);
        assert.isOk(newPeer._connection);
    });

    it('should send ping message by inactivity timer', async () => {
        const newPeer = new factory.Peer({peerInfo});
        const pushMessage = sinon.fake();
        newPeer.pushMessage = pushMessage;

        await newPeer.connect();
        newPeer._tick();

        assert.equal(pushMessage.callCount, 1);
        const [pingMsg] = pushMessage.args[0];
        assert.isTrue(pingMsg.isPing());
    });

    it('should increase attemts to connect to peer counter for a swithed off node', async () => {
        const newPeer = new factory.Peer({peerInfo});

        const failedConnectionCount = newPeer._peerInfo.failedConnectionCount;
        newPeer._transport.connect = sinon.fake.throws(new Error('Sone network error'));

        await newPeer.connect();

        assert.equal(newPeer._peerInfo.failedConnectionCount, failedConnectionCount + 1);
    });

    it('should mark node as dead if we have reached PEER_FAILED_CONNECTIONS_LIMIT of attempts', async () => {
        const newPeer = new factory.Peer({peerInfo});

        newPeer._peerInfo.failedConnectionCount = factory.Constants.PEER_FAILED_CONNECTIONS_LIMIT;
        newPeer._transport.connect = sinon.fake.throws(new Error('Sone network error'));

        await newPeer.connect();

        assert.isOk(newPeer.isDead());
    });

    it('should not be able to connect to a dead node', async () => {
        const newPeer = new factory.Peer({peerInfo});
        newPeer._peerInfo.failedConnectionCount = factory.Constants.PEER_FAILED_CONNECTIONS_LIMIT + 1;

        await newPeer.connect();

        assert.isOk(newPeer.disconnected);
        assert.isNotOk(newPeer._connection);
    });

    describe('updatePeerFromPeerInfo', function() {
        let newPeer;
        let strAddress;
        let peerInfo2;
        beforeEach(async () => {
            newPeer = new factory.Peer({peerInfo});
            strAddress = factory.Transport.generateAddress();
            const keyPair = factory.Crypto.createKeyPair();
            peerInfo2 = new factory.Messages.PeerInfo({
                capabilities: [
                    {service: factory.Constants.NODE, data: null},
                    {service: factory.Constants.WITNESS, data: Buffer.from(keyPair.address, 'hex')}
                ],
                address: factory.Transport.strToAddress(strAddress),
                port: 12345
            });
        });

        afterEach(async () => {
            sinon.restore();
        });

        it('should update', async () => {
            newPeer.updatePeerFromPeerInfo(peerInfo2, true);

            assert.strictEqual(newPeer.address, strAddress);
        });

        it('should not update (address not routable)', async () => {
            sinon.stub(factory.Transport, 'isRoutableAddress').returns(false);

            newPeer.updatePeerFromPeerInfo(peerInfo2, true);

            assert.notEqual(newPeer.address, strAddress);
        });

        it('should not update (disallow to rewrite)', async () => {
            newPeer.updatePeerFromPeerInfo(peerInfo2, false);

            assert.notEqual(newPeer.address, strAddress);
        });
    });
    describe('Whitelisted', async () => {
        let newPeer;
        beforeEach(async () => {
            newPeer = new factory.Peer({peerInfo});
        });

        it('should be NON whitelisted by default', async () => {
            assert.isNotOk(newPeer.isWhitelisted());
        });

        it('should ban NON whitelisted node', async () => {
            newPeer.ban();
            assert.isOk(newPeer.isBanned());
        });

        it('should whitelist', async () => {
            newPeer.markAsWhitelisted();
            assert.isOk(newPeer.isWhitelisted());
        });

        it('should NOT ban whitelisted peer', async () => {
            newPeer.markAsWhitelisted();
            newPeer.ban();
            assert.isNotOk(newPeer.isBanned());
        });
    });
});
