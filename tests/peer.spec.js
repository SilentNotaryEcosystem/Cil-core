const {describe, it} = require('mocha');
const {assert} = require('chai');
const debug = require('debug')('peer:');

const {sleep} = require('../utils');

factory = require('./testFactory');

let peerInfo;
let address;
let fakeNode;
let newPeer;

describe('Peer tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
        address = factory.Transport.generateAddress();
        peerInfo = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null}
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
        let peer;
        try {
            peer = new factory.Peer();
            assert.isOk(false, 'Unexpected success!');
        } catch (err) {
            debug(err);
        }
    });

    it('should create from connection', async () => {
        const newPeer = new factory.Peer({connection: {on: () => {}}});
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
        newPeer.on('message', (peer, msg) => msg === 'test' ? done() : done('Message corrupted'));
        newPeer._connection.emit('message', 'test');
    });

    it('should queue and send messages', async function() {
        this.timeout(5000);
        let nSendMessages = 0;
        const delay = 200;
        const newPeer = new factory.Peer({
            connection: {
                remoteAddress: factory.Transport.strToAddress(factory.Transport.generateAddress()),
                on: () => {},
                sendMessage: async () => {

                    // emulate network latency
                    await sleep(delay);
                    nSendMessages++;
                }
            }
        });
        for (let i = 0; i < 5; i++) {
            newPeer.pushMessage({message: `testMessage${i}`});
        }
        await sleep(delay * 6);
        assert.equal(nSendMessages, 5);
    });

    it('should NOT ban peer', async () => {
        const newPeer = new factory.Peer({connection: {on: () => {}}});
        assert.isOk(newPeer);
        newPeer.misbehave(1);
        assert.isNotOk(newPeer.banned);
        newPeer.misbehave(10);
        assert.isNotOk(newPeer.banned);
    });

    it('should ban peer', async () => {
        const newPeer = new factory.Peer({connection: {on: () => {}}});
        assert.isOk(newPeer);
        newPeer.misbehave(1);
        assert.isNotOk(newPeer.banned);
        newPeer.misbehave(factory.Constants.BAN_PEER_SCORE);
        assert.isOk(newPeer.banned);
    });
});
