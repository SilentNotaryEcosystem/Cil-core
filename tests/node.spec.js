'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();
const {sleep} = require('../utils');
const debug = require('debug')('node:test');

const factory = require('./testFactory');
const {createDummyTx, createDummyPeer, pseudoRandomBuffer} = require('./testUtil');

let seedAddress;
let seedNode;

const createTxAddCoinsToNode = (node) => {
    const patch = new factory.PatchDB();
    const keyPair = factory.Crypto.createKeyPair();
    const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);
    const txHash = pseudoRandomBuffer().toString('hex');

    // create "genezis"
    const coins = new factory.Coins(100000, buffAddress);
    patch.createCoins(txHash, 12, coins);
    patch.createCoins(txHash, 0, coins);
    patch.createCoins(txHash, 80, coins);

    node._storage.applyPatch(patch);

    const tx = new factory.Transaction();
    tx.addInput(txHash, 12);
    tx.addReceiver(1000, buffAddress);
    tx.sign(0, keyPair.privateKey);

    return {tx, keyPair};
};

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

        const peer = new factory.Peer(createDummyPeer(factory));
        peer.pushMessage = sinon.fake();

        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        const block = new factory.Block();

        block.addTx(tx);
        inv.addBlock(block);
        inv.addTx(tx);

        const msgInv = new factory.Messages.MsgInv(inv);
        await node._handleInvMessage(peer, msgInv);

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

        const peer = new factory.Peer(createDummyPeer(factory));
        peer.pushMessage = sinon.fake();

        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        const block = new factory.Block();

        block.addTx(tx);
        inv.addBlock(block);
        inv.addTx(tx);

        const msgInv = new factory.Messages.MsgInv(inv);
        await node._handleInvMessage(peer, msgInv);

        assert.isOk(node._mempool.hasTx.calledOnce);
        assert.isOk(node._storage.hasBlock.calledOnce);
        assert.isNotOk(peer.pushMessage.calledOnce);
    });

    it('should send MSG_TX & MSG_BLOCK', async () => {
        const node = new factory.Node({});
        node._mempool.getTx = sinon.fake.returns(new factory.Transaction(createDummyTx()));
        node._storage.getBlock = sinon.fake.returns(new factory.Block());

        const peer = new factory.Peer(createDummyPeer(factory));
        peer.pushMessage = sinon.fake();

        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        const block = new factory.Block();

        block.addTx(tx);
        inv.addBlock(block);
        inv.addTx(tx);

        const msgGetData = new factory.Messages.MsgGetData(inv);

        await node._handleGetDataMessage(peer, msgGetData);

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

        const peer = new factory.Peer(createDummyPeer(factory));
        peer.pushMessage = sinon.fake();

        const msgGetData = new factory.Messages.MsgGetData();

        // set random data to payload
        msgGetData.payload = Buffer.allocUnsafe(100);

        try {
            await node._handleGetData(peer, msgGetData);
        } catch (e) {
            assert.isNotOk(node._mempool.getTx.called);
            assert.isNotOk(node._storage.getBlock.called);
            assert.isNotOk(peer.pushMessage.called);
            return;
        }
        assert.isOk(false, 'Unexpected success');
    });

    it('should send NOTHING and mark peer misbehaving (no tx in mempool)', async () => {
        const node = new factory.Node({});
        node._mempool.getTx = sinon.fake.throws(new Error('No tx in mempool'));
        node._storage.getBlock = sinon.fake.returns(new factory.Block());

        const peer = new factory.Peer(createDummyPeer(factory));
        peer.pushMessage = sinon.fake();
        peer.misbehave = sinon.fake();

        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        inv.addTx(tx);

        const msgGetData = new factory.Messages.MsgGetData(inv);

        await node._handleGetDataMessage(peer, msgGetData);
        assert.isOk(peer.misbehave.calledOnce);
        assert.isOk(node._mempool.getTx.calledOnce);
        assert.isNotOk(peer.pushMessage.called);
    });

    it('should relay received TX to neighbors', async () => {
        const node = new factory.Node({});
        node._mempool.addTx = sinon.fake();
        node._informNeighbors = sinon.fake();

        const peer = new factory.Peer(createDummyPeer(factory));
        peer.misbehave = sinon.fake();

        const {tx} = createTxAddCoinsToNode(node);
        const msg = new factory.Messages.MsgTx(tx);

        await node._handleTxMessage(peer, msg);

        assert.isNotOk(peer.misbehave.called);
        assert.isOk(node._mempool.addTx.calledOnce);
        assert.isOk(node._informNeighbors.calledOnce);

        const [txToSend] = node._informNeighbors.args[0];
        assert.isOk(txToSend);
        assert.isOk(txToSend.equals(tx));
    });

    it('should NOT relay received TX (already known)', async () => {
        const err = 'err msg';
        const node = new factory.Node({});
        node._mempool.addTx = sinon.fake.throws(err);
        node._informNeighbors = sinon.fake();

        const peer = new factory.Peer(createDummyPeer(factory));
        peer.misbehave = sinon.fake();

        const {tx} = createTxAddCoinsToNode(node);
        const msg = new factory.Messages.MsgTx(tx);

        try {
            await node._handleTxMessage(peer, msg);
        } catch (e) {
            assert.equal(e.message, err);
            assert.isOk(node._mempool.addTx.calledOnce);
            assert.isNotOk(node._informNeighbors.called);
            return;
        }
        assert.isOk(false, 'Unexpected success');
    });

    it('should broadcast TX received via RPC', async () => {
        const node = new factory.Node({});
        node._mempool.addTx = sinon.fake();
        node._informNeighbors = sinon.fake();

        const {tx} = createTxAddCoinsToNode(node);

        node.rpc.sendRawTx(tx.encode());

        // it's async call so, let's sleep a bit
        await sleep(1000);

        assert.isOk(node._mempool.addTx.calledOnce);
        assert.isOk(node._informNeighbors.calledOnce);

        const [txToSend] = node._informNeighbors.args[0];
        assert.isOk(txToSend);
        assert.isOk(txToSend.equals(tx));
    });

    it('should process good block from MsgBlock', async () => {
        const node = new factory.Node({});
        node._app.processTx = sinon.fake.returns({});
        node._storage.saveBlock = sinon.fake();
        node._storage.applyPatch = sinon.fake();
        node._storage.getUtxosCreateMap = sinon.fake();
        node._informNeighbors = sinon.fake();

        const peer = new factory.Peer(createDummyPeer(factory));
        peer.ban = sinon.fake();

        const tx = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());
        const block = new factory.Block();
        block.addTx(tx);
        block.addTx(tx2);

        const msg = new factory.Messages.MsgBlock(block);

        await node._handleBlockMessage(peer, msg);

        assert.isOk(node._app.processTx.called);
        assert.isOk(node._app.processTx.callCount, 2);
        assert.isOk(node._storage.saveBlock.calledOnce);
        assert.isOk(node._storage.applyPatch.calledOnce);
        assert.isOk(node._informNeighbors.calledOnce);

    });

    it('should process BAD block from MsgBlock', async () => {
        const node = new factory.Node({});
        node._app.processTx = sinon.fake.throws('error');
        node._storage.saveBlock = sinon.fake();
        node._storage.applyPatch = sinon.fake();
        node._storage.getUtxosCreateMap = sinon.fake();
        node._informNeighbors = sinon.fake();

        const peer = new factory.Peer(createDummyPeer(factory));
        peer.ban = sinon.fake();

        const tx = new factory.Transaction(createDummyTx());
        const block = new factory.Block();
        block.addTx(tx);

        const msg = new factory.Messages.MsgBlock(block);

        try {
            await node._handleBlockMessage(peer, msg);
        } catch (e) {
            assert.isOk(node._app.processTx.called);
            assert.isOk(node._app.processTx.callCount, 1);
            assert.isNotOk(node._storage.saveBlock.called);
            assert.isNotOk(node._storage.applyPatch.called);
            assert.isNotOk(node._informNeighbors.called);
            return;
        }
        assert.isOk(false, 'Unexpected success');
    });

    it('should throw (no UTXO for tx)', async () => {
        const node = new factory.Node({});

        const txHash = pseudoRandomBuffer().toString('hex');
        const keyPair = factory.Crypto.createKeyPair();
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);

        // create tx
        const tx = new factory.Transaction();
        tx.addInput(txHash, 12);
        tx.addReceiver(100000, buffAddress);
        tx.sign(0, keyPair.privateKey);

        try {
            await node._processReceivedTx(tx);
        } catch (e) {
            return;
        }
        throw new Error('Unexpected success');
    });

    it('should throw (fee is too small)', async () => {
        const node = new factory.Node({});

        const patch = new factory.PatchDB();
        const keyPair = factory.Crypto.createKeyPair();
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);
        const txHash = pseudoRandomBuffer().toString('hex');

        // create "genezis"
        const coins = new factory.Coins(100000, buffAddress);
        patch.createCoins(txHash, 12, coins);

        node._storage.applyPatch(patch);

        const tx = new factory.Transaction();
        tx.addInput(txHash, 12);
        tx.addReceiver(100000, buffAddress);
        tx.sign(0, keyPair.privateKey);

        try {
            await node._processReceivedTx(tx);
        } catch (e) {
            assert.isOk(e.message.match(/fee 0 too small!$/));
            return;
        }
        throw new Error('Unexpected success');
    });

    it('should accept TX', async () => {
        const node = new factory.Node({});
        const {tx} = createTxAddCoinsToNode(node);

        await node._processReceivedTx(tx);
    });

    it('should process GENEZIS block', async () => {
        const node = new factory.Node({});
        node._app.processTx = sinon.fake.returns({fee: 1});
        node._storage.saveBlock = sinon.fake();
        node._storage.applyPatch = sinon.fake();
        node._informNeighbors = sinon.fake();

        const tx = new factory.Transaction(createDummyTx());
        const block = new factory.Block();
        block.addTx(tx);

        factory.Constants.GENEZIS_BLOCK = block.hash();
        await node._processBlock(block);

        assert.isOk(node._app.processTx.called);
        assert.isOk(node._app.processTx.callCount, 1);
        const [appTx, mapUtxos, , isGenezis] = node._app.processTx.args[0];
        assert.isOk(appTx.equals(tx));
        assert.isNotOk(mapUtxos);
        assert.isOk(isGenezis);

        assert.isOk(node._storage.saveBlock.called);
        assert.isOk(node._storage.applyPatch.called);
        assert.isOk(node._informNeighbors.called);
    });

});
