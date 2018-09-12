const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();
const {sleep} = require('../utils');

factory = require('./testFactory');
const {createDummyTx, createDummyPeer} = require('./testUtil');

let seedAddress;
let seedNode;

describe('Node tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();

        seedAddress = factory.Transport.generateAddress();
        seedNode = new factory.Node({listenAddr: seedAddress, delay: 10});
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
        [peerInfo1, peerInfo2, peerInfo3, peerInfo4].forEach(peerInfo => seedNode._peerManager.addPeer(peerInfo));

    });

    after(async function() {
        this.timeout(15000);
    });

    afterEach(function() {
        sinon.restore();
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
        const inMsg = new factory.Messages.MsgVersion({
            nonce: 12,
            peerInfo: {
                capabilities: [
                    {service: factory.Constants.NODE, data: null},
                    {service: factory.Constants.WITNESS, data: Buffer.from('asdasdasd')}
                ],
                address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x3}
            }
        });
        const msgCommon = new factory.Messages.MsgCommon(inMsg.encode());
        const sendMessage = sinon.fake.returns(Promise.resolve(null));
        const newPeer = new factory.Peer({
            connection: {
                listenerCount: sinon.fake(),
                remoteAddress: factory.Transport.generateAddress(),
                on: sinon.fake(),
                sendMessage
            }
        });
        await node._handleVersionMessage(newPeer, msgCommon);
        assert.equal(sendMessage.callCount, 2);
    });

    it('should prepare MsgAddr', async () => {
        const sendMessage = sinon.fake.returns(Promise.resolve(null));
        const newPeer = new factory.Peer({
            connection: {
                remoteAddress: factory.Transport.generateAddress(),
                listenerCount: sinon.fake(),
                on: sinon.fake(),
                sendMessage
            }
        });
        seedNode._handlePeerRequest(newPeer);
        assert.isOk(sendMessage.calledOnce);
        const [msg] = sendMessage.args[0];
        assert.isOk(msg && msg.isAddr());
        assert.isOk(msg.peers);
        assert.equal(msg.peers.length, 4);
        msg.peers.forEach(peerInfo => {
            assert.isOk(peerInfo && peerInfo.capabilities && peerInfo.address && peerInfo.port);
        });
    });

    it('should send GET_ADDR message', async () => {
        const sendMessage = sinon.fake.returns(Promise.resolve(null));
        const newPeer = new factory.Peer({
            connection: {
                remoteAddress: factory.Transport.generateAddress(),
                listenerCount: sinon.fake(),
                on: sinon.fake(),
                sendMessage
            }
        });

        // we need outgoing connection and version set
        newPeer.version = 123;
        newPeer._bInbound = false;
        await seedNode._handleVerackMessage(newPeer);
        assert.isOk(sendMessage.calledOnce);
        const [msg] = sendMessage.args[0];
        assert.isOk(msg && msg.isGetAddr());
    });

    // TODO: add message handlers test
    it('should send GET_DATA message', async () => {
        const node = new factory.Node({});
        node._mempool.hasTx = sinon.fake.returns(false);
        node._storage.hasBlock = sinon.fake.returns(false);

        const peer = new factory.Peer(createDummyPeer());
        peer.pushMessage = sinon.fake();

        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        const block = new factory.Block();

        block.addTx(tx);
        inv.addBlock(block);
        inv.addTx(tx);

        const msgInv = new factory.Messages.MsgInv(inv);
        await node._handleInv(peer, msgInv);

        assert.isOk(node._mempool.hasTx.calledOnce);
        assert.isOk(node._storage.hasBlock.calledOnce);
        assert.isOk(peer.pushMessage.calledOnce);

        const [msg] = peer.pushMessage.args[0];
        assert.isOk(msg.isGetData());
    });

    it('should NOT send GET_DATA message (that hashes are known to node)', async () => {
        const node = new factory.Node({});
        node._mempool.hasTx = sinon.fake.returns(true);
        node._storage.hasBlock = sinon.fake.returns(true);

        const peer = new factory.Peer(createDummyPeer());
        peer.pushMessage = sinon.fake();

        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        const block = new factory.Block();

        block.addTx(tx);
        inv.addBlock(block);
        inv.addTx(tx);

        const msgInv = new factory.Messages.MsgInv(inv);
        await node._handleInv(peer, msgInv);

        assert.isOk(node._mempool.hasTx.calledOnce);
        assert.isOk(node._storage.hasBlock.calledOnce);
        assert.isNotOk(peer.pushMessage.calledOnce);
    });

    it('should send MSG_TX & MSG_BLOCK', async () => {
        const node = new factory.Node({});
        node._mempool.getTx = sinon.fake.returns(new factory.Transaction(createDummyTx()));
        node._storage.getBlock = sinon.fake.returns(new factory.Block());

        const peer = new factory.Peer(createDummyPeer());
        peer.pushMessage = sinon.fake();

        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        const block = new factory.Block();

        block.addTx(tx);
        inv.addBlock(block);
        inv.addTx(tx);

        const msgGetData = new factory.Messages.MsgGetData(inv);

        await node._handleGetData(peer, msgGetData);

        assert.isOk(node._mempool.getTx.calledOnce);
        assert.isOk(node._storage.getBlock.calledOnce);
        assert.equal(peer.pushMessage.callCount, 2);

        const [msgTx] = peer.pushMessage.args[1];
        const [msgBlock] = peer.pushMessage.args[0];

        assert.isOk(msgTx.isTx());
        assert.isOk(msgBlock.isBlock());
    });

    it('should send NOTHING (bad msg)', async () => {
        const node = new factory.Node({});
        node._mempool.getTx = sinon.fake.returns(new factory.Transaction(createDummyTx()));
        node._storage.getBlock = sinon.fake.returns(new factory.Block());

        const peer = new factory.Peer(createDummyPeer());
        peer.pushMessage = sinon.fake();

        const msgGetData = new factory.Messages.MsgGetData();

        // set random data to payload
        msgGetData.payload = Buffer.allocUnsafe(100);

        try {
            await node._handleGetData(peer, msgGetData);
            assert.isOk(false, 'Unexpected success');
        } catch (e) {
            assert.isNotOk(node._mempool.getTx.called);
            assert.isNotOk(node._storage.getBlock.called);
            assert.isNotOk(peer.pushMessage.called);
        }
    });

    it('should send NOTHING and mark peer misbehaving (no tx in mempool)', async () => {
        const node = new factory.Node({});
        node._mempool.getTx = sinon.fake.throws(new Error('No tx in mempool'));
        node._storage.getBlock = sinon.fake.returns(new factory.Block());

        const peer = new factory.Peer(createDummyPeer());
        peer.pushMessage = sinon.fake();
        peer.misbehave = sinon.fake();

        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        inv.addTx(tx);

        const msgGetData = new factory.Messages.MsgGetData(inv);

        try {
            await node._handleGetData(peer, msgGetData);
            assert.isOk(false, 'Unexpected success');
        } catch (e) {
            assert.isOk(peer.misbehave.calledOnce);
            assert.isOk(node._mempool.getTx.calledOnce);
            assert.isNotOk(peer.pushMessage.called);
        }
    });

    it('should relay received TX to neighbors', async () => {
        const node = new factory.Node({});
        node._mempool.addTx = sinon.fake();
        node._relayTx = sinon.fake();

        const peer = new factory.Peer(createDummyPeer());
        peer.misbehave = sinon.fake();

        const tx = new factory.Transaction(createDummyTx());
        const msg = new factory.Messages.MsgTx(tx);

        await node._handleTx(peer, msg);

        assert.isNotOk(peer.misbehave.called);
        assert.isOk(node._mempool.addTx.calledOnce);
        assert.isOk(node._relayTx.calledOnce);

        const [txToSend] = node._relayTx.args[0];
        assert.isOk(txToSend);
        assert.isOk(txToSend.equals(tx));
    });

    it('should broadcast TX received via RPC', async () => {
        const node = new factory.Node({});
        node._mempool.addTx = sinon.fake();
        node._relayTx = sinon.fake();

        const tx = new factory.Transaction(createDummyTx());

        node.rpc.sendRawTx(tx.encode());

        assert.isOk(node._mempool.addTx.calledOnce);
        assert.isOk(node._relayTx.calledOnce);

        const [txToSend] = node._relayTx.args[0];
        assert.isOk(txToSend);
        assert.isOk(txToSend.equals(tx));
    });
});
