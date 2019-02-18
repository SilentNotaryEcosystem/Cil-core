'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();
const {sleep, arrayEquals, prepareForStringifyObject} = require('../utils');
const debug = require('debug')('node:test');

process.on('warning', e => console.warn(e.stack));

const factory = require('./testFactory');
const {
    createDummyTx,
    createDummyPeer,
    createDummyBlock,
    createDummyBlockWithTx,
    pseudoRandomBuffer,
    generateAddress
} = require('./testUtil');

let seedAddress;
let seedNode;

const groupId = 10;

const createContractInvocationTx = (maxFee = 1e3, hasChangeReceiver = true) => {
    const contractAddr = generateAddress();

    // prepare tx (for non genesis block)
    const tx = new factory.Transaction();
    tx.witnessGroupId = groupId;
    tx.addInput(pseudoRandomBuffer(), 12);
    if (hasChangeReceiver) {
        tx.invokeContract(contractAddr, '', 0, maxFee, generateAddress());
    } else {
        tx.invokeContract(contractAddr, '', 0, maxFee);
    }
    tx.verify = sinon.fake();

    return {tx, strContractAddr: contractAddr.toString('hex')};
};

const createTxAddCoinsToNode = (node) => {
    const patch = new factory.PatchDB(0);
    const keyPair = factory.Crypto.createKeyPair();
    const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);
    const txHash = pseudoRandomBuffer().toString('hex');

    // create "genesis"
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

const createGroupDefAndSignBlock = (block, numOfSignatures = 2) => {
    const arrPubKeys = [];
    const arrSignatures = [];
    const buffHash = block.hash();
    for (let i = 0; i < numOfSignatures; i++) {
        const keyPair = factory.Crypto.createKeyPair();
        arrPubKeys.push(Buffer.from(keyPair.publicKey, 'hex'));
        arrSignatures.push(factory.Crypto.sign(buffHash, keyPair.privateKey));
    }
    block.addWitnessSignatures(arrSignatures);
    return factory.WitnessGroupDefinition.create(block.witnessGroupId, arrPubKeys);
};

const createSimpleChain = async (callback) => {
    const arrHashes = [];

    let prevBlock = null;
    for (let i = 0; i < 10; i++) {
        const block = createDummyBlock(factory);
        if (prevBlock) {
            block.parentHashes = [prevBlock.getHash()];
        } else {
            factory.Constants.GENESIS_BLOCK = block.getHash();
        }
        prevBlock = block;
        await callback(block);
        arrHashes.push(block.getHash());
    }
    return arrHashes;
};

const createSimpleFork = async (callback) => {
    const genesis = createDummyBlock(factory);
    factory.Constants.GENESIS_BLOCK = genesis.getHash();

    const block1 = createDummyBlock(factory);
    block1.parentHashes = [genesis.getHash()];
    const block2 = createDummyBlock(factory);
    block2.parentHashes = [genesis.getHash()];
    const block3 = createDummyBlock(factory);
    block3.parentHashes = [block1.getHash(), block2.getHash()];

    await callback(genesis);
    await callback(block1);
    await callback(block2);
    await callback(block3);

    return [genesis, block1, block2, block3].map(block => block.getHash());
};

describe('Node tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();

        seedAddress = factory.Transport.generateAddress();
        seedNode = new factory.Node({listenAddr: seedAddress, delay: 10, isSeed: true});
        await seedNode.ensureLoaded();
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
            await seedNode._peerManager.addPeer(peerInfo);
        }

    });

    after(async function() {
        this.timeout(15000);
    });

    afterEach(function() {
        sinon.restore();
    });

    it('should create a Node', async () => {
        const node = new factory.Node();
        assert.isOk(node);
    });

    it('should perform all async load', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        assert.isOk(node);
        assert.isOk(node._myPeerInfo);
        assert.isOk(node._peerManager);
    });

    it('should resolve DNS seeds', async () => {
        const node = new factory.Node({arrDnsSeeds: ['a-b', 'c-d']});
        assert.isOk(node);
        const arrAddresses = await node._queryDnsRecords(['a-b', 'c-d']);
        assert.deepEqual(arrAddresses, ['a', 'b', 'c', 'd']);
    });

    it('should merge seeds', async () => {
        const node = new factory.Node({arrDnsSeeds: ['a-b', 'c-d'], arrSeedAddresses: ['e', 'f']});
        await node.ensureLoaded();
        assert.isOk(node);
        await node._mergeSeedPeers();
        assert.deepEqual(node._arrSeedAddresses, ['e', 'f', 'a', 'b', 'c', 'd']);
    });

    it('should _storeBlockAndInfo', async () => {
        const node = new factory.Node();
        const block = createDummyBlock(factory);
        await node.ensureLoaded();

        await node._storeBlockAndInfo(block, new factory.BlockInfo(block.header));
        assert.isOk(await node._storage.getBlock(block.getHash()));
        assert.isOk(node._mainDag.getBlockInfo(block.getHash()));
    });

    it('should prepare verAckMessage', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();
        node._peerManager.associatePeer = sinon.fake.returns(new factory.Peer(createDummyPeer(factory)));

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
        assert.isOk(node._peerManager.associatePeer.calledOnce);
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

        // 4 known + self
        assert.equal(msg.peers.length, 5);
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
        const node = new factory.Node();
        node._mempool.hasTx = sinon.fake.returns(false);
        node._storage.hasBlock = sinon.fake.returns(false);

        const peer = new factory.Peer(createDummyPeer(factory));
        peer.pushMessage = sinon.fake();

        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        const block = new factory.Block(0);

        block.addTx(tx);
        block.finish(factory.Constants.MIN_TX_FEE, pseudoRandomBuffer(33));

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
        const node = new factory.Node();
        node._mempool.hasTx = sinon.fake.returns(true);
        node._storage.hasBlock = sinon.fake.returns(true);

        const peer = new factory.Peer(createDummyPeer(factory));
        peer.pushMessage = sinon.fake();

        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        const block = new factory.Block(0);

        block.addTx(tx);
        block.finish(factory.Constants.MIN_TX_FEE, pseudoRandomBuffer(33));

        inv.addBlock(block);
        inv.addTx(tx);

        const msgInv = new factory.Messages.MsgInv(inv);
        await node._handleInvMessage(peer, msgInv);

        assert.isOk(node._mempool.hasTx.calledOnce);
        assert.isOk(node._storage.hasBlock.calledOnce);
        assert.isNotOk(peer.pushMessage.calledOnce);
    });

    it('should send MSG_TX & MSG_BLOCK', async () => {
        const node = new factory.Node();

        node._mempool.getTx = sinon.fake.returns(new factory.Transaction(createDummyTx()));
        node._storage.getBlock = sinon.fake.returns(createDummyBlock(factory));

        const peer = new factory.Peer(createDummyPeer(factory));
        peer.pushMessage = sinon.fake();

        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        const block = createDummyBlock(factory);

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
        const node = new factory.Node();
        node._mempool.getTx = sinon.fake.returns(new factory.Transaction(createDummyTx()));
        node._storage.getBlock = sinon.fake.returns(new factory.Block(0));

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
        const node = new factory.Node();
        node._mempool.getTx = sinon.fake.throws(new Error('No tx in mempool'));
        node._storage.getBlock = sinon.fake.returns(new factory.Block(0));

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
        const node = new factory.Node();
        node._mempool.addTx = sinon.fake();
        node._informNeighbors = sinon.fake();

        const peer = new factory.Peer(createDummyPeer(factory));
        peer.misbehave = sinon.fake();

        const {tx} = createTxAddCoinsToNode(node);
        const msg = new factory.Messages.MsgTx(tx);

        node._requestCache.request(tx.hash());

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
        const node = new factory.Node();
        node._mempool.addTx = sinon.fake.throws(err);
        node._informNeighbors = sinon.fake();

        const peer = new factory.Peer(createDummyPeer(factory));
        peer.misbehave = sinon.fake();

        const {tx} = createTxAddCoinsToNode(node);
        const msg = new factory.Messages.MsgTx(tx);

        node._requestCache.request(tx.hash());

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

    it('should process received TX', async function() {
        const node = new factory.Node();
        node._mempool.addTx = sinon.fake();
        node._informNeighbors = sinon.fake();

        const {tx} = createTxAddCoinsToNode(node);

        await node._processReceivedTx(tx);

        assert.isOk(node._mempool.addTx.calledOnce);
        assert.isOk(node._informNeighbors.calledOnce);

        const [txToSend] = node._informNeighbors.args[0];
        assert.isOk(txToSend);
        assert.isOk(txToSend.equals(tx));
    });

    it('pass TX, received via RPC, to processing', async function() {
        this.timeout(5000);

        const node = new factory.Node({rpcAddress: factory.Transport.generateAddress()});
        await node.ensureLoaded();

        node._mempool.addTx = sinon.fake();
        node._informNeighbors = sinon.fake();

        const {tx} = createTxAddCoinsToNode(node);
        const donePromise = new Promise((resolve, reject) => {
            node._processReceivedTx = async (cTx) => {
                if (cTx.hash() === tx.hash()) {
                    resolve();
                } else {
                    reject();
                }
            };
        });
        node.rpc.sendRawTx({buffTx: tx.encode()});
        await donePromise;
    });

    it('should process NEW block from MsgBlock', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        const block = createDummyBlock(factory);
        const msg = new factory.Messages.MsgBlock(block);

        node._mainDag.getBlockInfo = sinon.fake.resolves(false);
        node._processBlock = sinon.fake();
        node._requestCache.request(block.hash());

        await node._handleBlockMessage(undefined, msg);

        assert.isOk(node._processBlock.called);
    });

    it('should omit KNOWN block from MsgBlock', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        const block = createDummyBlock(factory);
        const msg = new factory.Messages.MsgBlock(block);
        node._requestCache.request(block.hash());
        node._mainDag.getBlockInfo = sinon.fake.resolves(true);

        await node._handleBlockMessage(undefined, msg);

        assert.isNotOk(node._processBlock.called);
    });

    it('should process good block', async () => {
        const tx = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());
        const parentBlock = createDummyBlock(factory);
        const block = new factory.Block(0);
        block.addTx(tx);
        block.addTx(tx2);
        block.finish(factory.Constants.MIN_TX_FEE, pseudoRandomBuffer(33));
        block.parentHashes = [parentBlock.getHash()];

        const node = new factory.Node();
        await node.ensureLoaded();

        node._verifyBlockSignatures = sinon.fake.resolves(true);
        node._pendingBlocks.addBlock(parentBlock, new factory.PatchDB());
        await node._storeBlockAndInfo(parentBlock, new factory.BlockInfo(parentBlock.header));

        node._app.processTxInputs = sinon.fake.returns({totalHas: 10000, patch: new factory.PatchDB});
        node._app.processPayments = sinon.fake.returns(0);

        node._storage.applyPatch = sinon.fake();
        node._storage.getUtxosCreateMap = sinon.fake();
        node._informNeighbors = sinon.fake();
        node._checkCoinbaseTx = sinon.fake();
        node._requestCache.request(block.hash());

        const peer = new factory.Peer(createDummyPeer(factory));
        peer.ban = sinon.fake();

        const msg = new factory.Messages.MsgBlock(block);

        await node._handleBlockMessage(peer, msg);

        assert.isOk(node._app.processPayments.called);
        assert.isOk(node._app.processPayments.callCount, 2);
        assert.isOk(await node._storage.getBlock(block.getHash()));
        assert.isOk(node._informNeighbors.calledOnce);

        assert.isNotOk(peer.ban.called);
    });

    it('should process BAD block from MsgBlock', async () => {
        const block = createDummyBlockWithTx(factory);

        const groupDef = createGroupDefAndSignBlock(block);
        const node = new factory.Node({arrTestDefinition: [groupDef]});
        await node.ensureLoaded();

        // make this block BAD
        node._app.processTxInputs = sinon.fake.throws('error');

        node._storage.applyPatch = sinon.fake();
        node._storage.getUtxosCreateMap = sinon.fake();
        node._verifyBlock = sinon.fake.returns(true);
        node._canExecuteBlock = sinon.fake.returns(true);
        node._informNeighbors = sinon.fake();
        node._requestCache.request(block.hash());

        const peer = new factory.Peer(createDummyPeer(factory));
        peer.misbehave = sinon.fake();

        const msg = new factory.Messages.MsgBlock(block);

        try {
            await node._handleBlockMessage(peer, msg);
        } catch (e) {
            assert.isOk(node._app.processTxInputs.called);
            assert.isOk(node._app.processTxInputs.callCount, 2);
            assert.isNotOk(node._storage.saveBlock.called);
            assert.isNotOk(node._storage.applyPatch.called);
            assert.isNotOk(node._informNeighbors.called);
            assert.isOk(peer.misbehave.calledOnce);
            return;
        }
        assert.isOk(false, 'Unexpected success');
    });

    it('should throw while _processReceivedTx (no UTXO for tx)', async () => {
        const node = new factory.Node();

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

    it('should throw while _processReceivedTx (fee is too small)', async () => {
        const node = new factory.Node();

        const patch = new factory.PatchDB(0);
        const keyPair = factory.Crypto.createKeyPair();
        const buffAddress = factory.Crypto.getAddress(keyPair.publicKey, true);
        const txHash = pseudoRandomBuffer().toString('hex');

        // create "genesis"
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
        const node = new factory.Node();
        const {tx} = createTxAddCoinsToNode(node);

        await node._processReceivedTx(tx);
    });

    it('should process GENESIS block', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        // Inputs doesn't checked for Genesis
        node._app.processPayments = sinon.fake.returns(0);

        node._storage.saveBlock = sinon.fake();
        node._storage.applyPatch = sinon.fake();
        node._informNeighbors = sinon.fake();

        const tx = new factory.Transaction(createDummyTx());
        const block = new factory.Block(0);
        block.addTx(tx);
        block.finish(factory.Constants.MIN_TX_FEE, pseudoRandomBuffer(33));

        factory.Constants.GENESIS_BLOCK = block.hash();
        await node._execBlock(block);

        assert.isOk(node._app.processPayments.called);

        // coinbase is not processed by app
        assert.equal(node._app.processPayments.callCount, 1);
        const [appTx, patch] = node._app.processPayments.args[0];
        assert.isOk(appTx.equals(tx));
        assert.isOk(patch);
    });

    it('should fail to check COINBASE (not a coinbase)', async () => {
        const node = new factory.Node();
        const tx = new factory.Transaction(createDummyTx());
        assert.throws(() => node._checkCoinbaseTx(tx.rawData, tx.amountOut()));
    });

    it('should fail to check COINBASE (bad amount)', async () => {
        const node = new factory.Node();
        const coinbase = factory.Transaction.createCoinbase();
        coinbase.addReceiver(100, generateAddress());
        assert.throws(() => node._checkCoinbaseTx(coinbase.rawData, tx.amountOut() - 1));
    });

    it('should accept COINBASE', async () => {
        const node = new factory.Node();
        const coinbase = factory.Transaction.createCoinbase();
        coinbase.addReceiver(100, pseudoRandomBuffer(20));
        assert.throws(() => node._checkCoinbaseTx(coinbase.rawData, tx.amountOut()));
    });

    it('should fail check BLOCK SIGNATURES (unknown group)', async () => {
        const block = createDummyBlock(factory);
        const node = new factory.Node();

        try {
            await node._verifyBlockSignatures(block);
        } catch (e) {
            console.error(e);
            assert.equal(e.message, 'Unknown witnessGroupId: 0');
            return;
        }
        throw ('Unexpected success');
    });

    it('should fail check BLOCK SIGNATURES (not enough signatures)', async () => {
        const block = createDummyBlock(factory);
        createGroupDefAndSignBlock(block);

        const block2 = createDummyBlock(factory);
        const groupDef2 = createGroupDefAndSignBlock(block2, 7);

        // groupId: 0 will have different keys used for block2
        const node = new factory.Node();
        node._storage.getWitnessGroupById = sinon.fake.resolves(groupDef2);

        try {
            await node._verifyBlockSignatures(block);
        } catch (e) {
            console.error(e);
            assert.equal(e.message, 'Expected 4 signatures, got 2');
            return;
        }
        throw ('Unexpected success');
    });

    it('should fail check BLOCK SIGNATURES (bad signatures)', async () => {
        const block = createDummyBlock(factory);
        createGroupDefAndSignBlock(block);

        const block2 = createDummyBlock(factory);
        const groupDef2 = createGroupDefAndSignBlock(block2);

        // groupId: 0 will have different keys used for block2
        const node = new factory.Node();
        node._storage.getWitnessGroupById = sinon.fake.resolves(groupDef2);

        try {
            await node._verifyBlockSignatures(block);
        } catch (e) {
            assert.isOk(e.message.startsWith('Bad signature for block'));
            console.error(e);
            return;
        }
        throw ('Unexpected success');
    });

    it('should check BLOCK SIGNATURES', async () => {
        const block = createDummyBlock(factory);
        const groupDef = createGroupDefAndSignBlock(block);
        const node = new factory.Node();
        node._storage.getWitnessGroupById = sinon.fake.resolves(groupDef);

        await node._verifyBlockSignatures(block);
    });

    it('should build EMPTY MainDag (no blocks were processed-final)', async () => {
        const node = new factory.Node();

        let prevBlock = null;
        for (let i = 0; i < 10; i++) {
            const block = createDummyBlock(factory);
            if (prevBlock) {
                block.parentHashes = [prevBlock.getHash()];
            } else {
                prevBlock = block;
            }
            await node._storage.saveBlock(block);
        }

        const arrPendingHashes = await node._storage.getPendingBlockHashes();
        await node._buildMainDag(arrPendingHashes);
        assert.equal(node._mainDag.order, 0);
        assert.equal(node._mainDag.size, 0);
    });

    it('should build MainDag from chainlike', async () => {
        const node = new factory.Node();

        const arrHashes = await createSimpleChain(async block => await node._storage.saveBlock(block));
        await node._storage.updateLastAppliedBlocks([arrHashes[8]]);
        await node._storage.updatePendingBlocks([arrHashes[9]]);

        const arrPendingHashes = await node._storage.getPendingBlockHashes();
        await node._buildMainDag(arrPendingHashes);

        assert.equal(node._mainDag.order, 10);
        assert.equal(node._mainDag.size, 9);
    });

    it('should build MainDag from simple fork', async () => {
        const node = new factory.Node();
        const arrBlocks = [];

        await createSimpleFork(async block => {
            await node._storage.saveBlock(block);
            arrBlocks.push(block);
        });

        await node._storage.updateLastAppliedBlocks([arrBlocks[3].getHash()]);

        // this is cheat. this block appears in stable & pending sections
        await node._storage.updatePendingBlocks([arrBlocks[3].getHash()]);

        const arrPendingHashes = await node._storage.getPendingBlockHashes();
        await node._buildMainDag(arrPendingHashes);

        assert.equal(node._mainDag.order, 4);
        assert.equal(node._mainDag.size, 4);

        assert.deepEqual(
            node._mainDag.getParents(arrBlocks[3].getHash()),
            [arrBlocks[1].getHash(), arrBlocks[2].getHash()]
        );
        assert.deepEqual(
            node._mainDag.getChildren(arrBlocks[0].getHash()),
            [arrBlocks[1].getHash(), arrBlocks[2].getHash()]
        );
    });

    it('should build PendingBlocks upon startup (from simple chain)', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        const arrHashes = await createSimpleChain(async block => await node._storage.saveBlock(block));

        //
        await node._storage.updatePendingBlocks(arrHashes);
        node._checkCoinbaseTx = sinon.fake();

        const arrPendingHashes = await node._storage.getPendingBlockHashes();
        const arrStableHashes = await node._storage.getLastAppliedBlockHashes();
        await node._rebuildPending(arrStableHashes, arrPendingHashes);

        assert.equal(node._pendingBlocks.getDag().order, 10);
        assert.equal(node._pendingBlocks.getDag().size, 9);
    });

    it('should build PendingBlocks upon startup (from simple fork)', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        const arrBlocks = [];

        await createSimpleFork(async block => {
            await node._storage.saveBlock(block);
            arrBlocks.push(block);
        });

        //
        await node._storage.updatePendingBlocks(
            [arrBlocks[0].getHash(), arrBlocks[1].getHash(), arrBlocks[2].getHash(), arrBlocks[3].getHash()]
        );
        node._checkCoinbaseTx = sinon.fake();

        const arrPendingHashes = await node._storage.getPendingBlockHashes();
        const arrStableHashes = await node._storage.getLastAppliedBlockHashes();
        await node._rebuildPending(arrStableHashes, arrPendingHashes);

        assert.equal(node._pendingBlocks.getDag().order, 4);
        assert.equal(node._pendingBlocks.getDag().size, 4);
    });

    it('should request unknown parent', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        const block = createDummyBlock(factory);

        node._requestUnknownBlocks = sinon.fake();
        node._verifyBlockSignatures = sinon.fake();

        await node._processBlock(block);

        assert.isOk(node._requestUnknownBlocks.calledOnce);
        assert.isOk(node._setUnknownBlocks.size, 1);
        assert.isOk(node._setUnknownBlocks.has(block.parentHashes[0]));
    });

    it('should process MSG_GET_BLOCKS (simple chain)', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        const arrHashes = await createSimpleChain(
            block => node._mainDag.addBlock(new factory.BlockInfo(block.header)));

        // we expect receive INV message with all hashes except Genesis
        const msgGetBlock = new factory.Messages.MsgGetBlocks();
        msgGetBlock.arrHashes = [factory.Constants.GENESIS_BLOCK];

        const peer = createDummyPeer(factory);
        peer.pushMessage = sinon.fake();
        const msgCommon = new factory.Messages.MsgCommon(msgGetBlock.encode());
        await node._handleGetBlocksMessage(peer, msgCommon);

        assert.isOk(peer.pushMessage.calledOnce);
        const [msg] = peer.pushMessage.args[0];
        assert.isOk(msg.isInv());
        const vector = msg.inventory.vector;
        assert.equal(vector.length, 9);
        assert.isOk(
            vector.every(v =>
                Buffer.isBuffer(v.hash) &&
                v.hash.length === 32 &&
                v.type === factory.Constants.INV_BLOCK
                && arrHashes.includes(v.hash.toString('hex'))
            )
        );
    });

    it('should process MSG_GET_BLOCKS (simple fork)', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        const arrHashes = [];
        await createSimpleFork(block => {
            node._mainDag.addBlock(new factory.BlockInfo(block.header));
            arrHashes.push(block.getHash());
        });

        // we expect receive INV message with all hashes except Genesis
        const msgGetBlock = new factory.Messages.MsgGetBlocks();
        msgGetBlock.arrHashes = [factory.Constants.GENESIS_BLOCK];

        const peer = createDummyPeer(factory);
        peer.pushMessage = sinon.fake();
        const msgCommon = new factory.Messages.MsgCommon(msgGetBlock.encode());

        await node._handleGetBlocksMessage(peer, msgCommon);

        assert.isOk(peer.pushMessage.calledOnce);
        const [msg] = peer.pushMessage.args[0];
        assert.isOk(msg.isInv());
        const vector = msg.inventory.vector;
        assert.equal(vector.length, 3);
        assert.isOk(
            vector.every(v =>
                Buffer.isBuffer(v.hash) &&
                v.hash.length === 32 &&
                v.type === factory.Constants.INV_BLOCK
                && arrHashes.includes(v.hash.toString('hex'))
            )
        );
    });

    it('should process 2 good hashed from chain', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        const arrHashes = await createSimpleChain(
            block => node._mainDag.addBlock(new factory.BlockInfo(block.header)));

        const msgGetBlock = new factory.Messages.MsgGetBlocks();
        msgGetBlock.arrHashes = [arrHashes[3], arrHashes[7]];

        const peer = createDummyPeer(factory);
        peer.pushMessage = sinon.fake();
        const msgCommon = new factory.Messages.MsgCommon(msgGetBlock.encode());
        await node._handleGetBlocksMessage(peer, msgCommon);

        assert.isOk(peer.pushMessage.calledOnce);
        const [msg] = peer.pushMessage.args[0];
        assert.isOk(msg.isInv());
        const vector = msg.inventory.vector;

        // we should have all starting from 3d hash (including 7)
        assert.equal(vector.length, 6);
        assert.isOk(
            vector.every(v =>
                Buffer.isBuffer(v.hash) &&
                v.hash.length === 32 &&
                v.type === factory.Constants.INV_BLOCK
                && arrHashes.includes(v.hash.toString('hex'))
            )
        );

    });

    it('should process 2 good hashed from fork', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        const arrHashes = [];
        await createSimpleFork(block => {
            node._mainDag.addBlock(new factory.BlockInfo(block.header));
            arrHashes.push(block.getHash());
        });

        // we expect receive INV message with tip only
        const msgGetBlock = new factory.Messages.MsgGetBlocks();
        msgGetBlock.arrHashes = [arrHashes[1], arrHashes[2]];

        const peer = createDummyPeer(factory);
        peer.pushMessage = sinon.fake();
        const msgCommon = new factory.Messages.MsgCommon(msgGetBlock.encode());

        await node._handleGetBlocksMessage(peer, msgCommon);

        assert.isOk(peer.pushMessage.calledOnce);
        const [msg] = peer.pushMessage.args[0];
        assert.isOk(msg.isInv());
        const vector = msg.inventory.vector;
        assert.equal(vector.length, 1);
        const [{hash}] = vector;
        assert.equal(hash.toString('hex'), arrHashes[3]);
    });

    it('should return full DAG (empty hash array received)', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        const arrHashes = await createSimpleChain(
            block => node._mainDag.addBlock(new factory.BlockInfo(block.header)));

        const msgGetBlock = new factory.Messages.MsgGetBlocks();
        msgGetBlock.arrHashes = [];

        const peer = createDummyPeer(factory);
        peer.pushMessage = sinon.fake();
        const msgCommon = new factory.Messages.MsgCommon(msgGetBlock.encode());

        await node._handleGetBlocksMessage(peer, msgCommon);

        assert.isOk(peer.pushMessage.calledOnce);
        const [msg] = peer.pushMessage.args[0];
        assert.isOk(msg.isInv());
        const vector = msg.inventory.vector;

        assert.equal(vector.length, 10);
        assert.isOk(arrayEquals(vector.map(v => v.hash.toString('hex')), arrHashes));
    });

    it('should return full DAG (bad hashes received)', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        const arrHashes = await createSimpleChain(
            block => node._mainDag.addBlock(new factory.BlockInfo(block.header)));

        const msgGetBlock = new factory.Messages.MsgGetBlocks();
        msgGetBlock.arrHashes = [arrHashes[3], pseudoRandomBuffer()];

        const peer = createDummyPeer(factory);
        peer.pushMessage = sinon.fake();
        const msgCommon = new factory.Messages.MsgCommon(msgGetBlock.encode());

        await node._handleGetBlocksMessage(peer, msgCommon);

        assert.isOk(peer.pushMessage.calledOnce);
        const [msg] = peer.pushMessage.args[0];
        assert.isOk(msg.isInv());
        const vector = msg.inventory.vector;
        assert.equal(vector.length, 10);
        assert.isOk(arrayEquals(vector.map(v => v.hash.toString('hex')), arrHashes));
    });

    it('should send Reject message if time offset very large', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

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
        inMsg._data.timeStamp =
            parseInt(Date.now() + factory.Constants.TOLERATED_TIME_DIFF) / 1000 + 100;
        const msgCommon = new factory.Messages.MsgCommon(inMsg.encode());
        const sendMessage = sinon.fake.returns(Promise.resolve(null));
        const newPeer = new factory.Peer({
            connection: {
                listenerCount: sinon.fake(),
                remoteAddress: factory.Transport.generateAddress(),
                on: sinon.fake(),
                sendMessage,
                close: () => {}
            }
        });
        const peer = await node._peerManager.addPeer(newPeer);

        await node._handleVersionMessage(newPeer, msgCommon);
        assert.equal(sendMessage.callCount, 1);

        const [msg] = sendMessage.args[0];
        assert.isTrue(msg.isReject());

    });

    it('should unwind block to mempool', async () => {
        const node = new factory.Node();
        const block = createDummyBlock(factory);
        const tx = new factory.Transaction(block.txns[0]);

        await node._unwindBlock(block);
        assert.isOk(node._mempool.hasTx(tx.hash()));

    });

    it('should reconnect peers', async function() {
        this.timeout(4000);
        const node = new factory.Node();
        await node.ensureLoaded();

        const pushMessage = sinon.fake.returns(Promise.resolve(null));
        const loaded = sinon.fake.returns(Promise.resolve(null));
        const connectToPeer = sinon.fake.returns(Promise.resolve(null));
        node._connectToPeer = connectToPeer;

        const peers = [
            new factory.Peer({
                peerInfo: {
                    capabilities: [
                        {service: factory.Constants.NODE, data: null},
                        {service: factory.Constants.WITNESS, data: Buffer.from('asdasdasd')}
                    ],
                    address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x3}
                }
            }),
            new factory.Peer({
                peerInfo: {
                    capabilities: [
                        {service: factory.Constants.NODE, data: null}
                    ],
                    address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x4}
                }
            }),
            new factory.Peer({
                peerInfo: {
                    capabilities: [
                        {service: factory.Constants.WITNESS, data: Buffer.from('1111')}
                    ],
                    address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x5}
                }
            }),
            new factory.Peer({
                peerInfo: {
                    capabilities: [
                        {service: factory.Constants.WITNESS, data: Buffer.from('2222')}
                    ],
                    address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x6}
                }
            })
        ];
        peers.forEach((peer) => {
            peer.pushMessage = pushMessage;
            peer.loaded = loaded;
            node._peerManager.addPeer(peer);
        });
        await node._reconnectPeers();
        assert.equal(connectToPeer.callCount, 3);
        assert.equal(pushMessage.callCount, 3);
    });

    it('should call createContract', async () => {
        const node = new factory.Node();
        const tx = factory.Transaction.createContract(
            'class A extends Base{}',
            10000,
            generateAddress()
        );

        const contract = new factory.Contract({});
        contract.storeAddress(generateAddress());
        node._app.createContract =
            sinon.fake.returns({contract, receipt: new factory.TxReceipt({coinsUsed: 1000})});

        // mark it as Genesis block TX (it skip many checks, like signatures & inputs)
        await node._processTx(true, tx);

        assert.isOk(node._app.createContract.called);
    });

    it('should call runContract', async () => {
        const node = new factory.Node();
        const contractAddr = generateAddress();
        const groupId = 10;

        const {tx} = createContractInvocationTx();

        node._storage.getContract = sinon.fake.returns(new factory.Contract({groupId}, contractAddr.toString('hex')));
        node._app.runContract = sinon.fake.returns(new factory.TxReceipt({coinsUsed: 1000}));

        // mark it as Genesis block TX (it skip many checks, like signatures & inputs)
        await node._processTx(true, tx, new factory.PatchDB(groupId));

        assert.isOk(node._app.runContract.calledOnce);
        const [coinsLimit, strInvocationCode, contract] = node._app.runContract.args[0];
        assert.equal(coinsLimit, Number.MAX_SAFE_INTEGER);
        assert.isOk(typeof strInvocationCode === 'string');
        assert.isOk(contract instanceof factory.Contract);
    });

    it('should get contact from Patch', async () => {
        const node = new factory.Node();
        const {tx} = createContractInvocationTx();
        const patch = new factory.PatchDB(groupId);

        patch.getContract = sinon.fake.returns(new factory.Contract({groupId}));
        node._storage.getContract = sinon.fake();

        const contract = await node._getContractFromTx(tx, patch);
        assert.isOk(contract);
        assert.isOk(patch.getContract.calledOnce);
        assert.isNotOk(node._storage.getContract.calledOnce);
    });

    it('should get contact from Storage', async () => {
        const node = new factory.Node();
        const {tx} = createContractInvocationTx();
        const patch = new factory.PatchDB(groupId);

        patch.getContract = sinon.fake.returns(undefined);
        node._storage.getContract = sinon.fake.resolves(new factory.Contract({groupId}));

        const contract = await node._getContractFromTx(tx, patch);
        assert.isOk(contract);
        assert.isOk(patch.getContract.calledOnce);
        assert.isOk(node._storage.getContract.calledOnce);
    });

    it('should FAIL to invoke contract (small fee)', async () => {
        const node = new factory.Node();
        const nTotalHas = 1e5;

        const {tx, strContractAddr} = createContractInvocationTx(1e4);

        node._storage.getUtxosCreateMap = sinon.fake();
        node._storage.getContract = sinon.fake.returns(new factory.Contract({groupId}, strContractAddr));

        node._app.processTxInputs = sinon.fake.returns({totalHas: nTotalHas, patch: new factory.PatchDB()});
        node._app.runContract = sinon.fake.returns(new factory.TxReceipt({coinsUsed: 1000}));

        try {
            await node._processTx(false, tx, new factory.PatchDB(groupId));
        } catch (e) {
            assert.isOk(e.message.match('CONTRACT fee .+ less than .+'));
            return;
        }
        throw new Error('Unexpected success');
    });

    it('should invoke contract', async () => {
        const node = new factory.Node();
        const nTotalHas = 1e5;
        const nChange = 1e4;

        const {tx, strContractAddr} = createContractInvocationTx(nTotalHas);
        tx.addReceiver(nChange, generateAddress());

        node._storage.getUtxosCreateMap = sinon.fake();
        node._storage.getContract = sinon.fake.returns(new factory.Contract({groupId}, strContractAddr));

        node._app.processTxInputs = sinon.fake.returns({totalHas: nTotalHas, patch: new factory.PatchDB()});
        node._app.runContract = sinon.fake.returns(new factory.TxReceipt({coinsUsed: 1000}));

        await node._processTx(false, tx, new factory.PatchDB(groupId));

        assert.isOk(node._app.runContract.calledOnce);
        const [coinsLimit, strInvocationCode, contract] = node._app.runContract.args[0];
        assert.equal(coinsLimit, nTotalHas - nChange);
        assert.isOk(typeof strInvocationCode === 'string');
        assert.isOk(contract instanceof factory.Contract);
    });

    it('should use all INPUT coins as fee (no changeReceiver no change output)', async () => {
        const node = new factory.Node();
        const nTotalHas = 1e5;
        const nChange = 1e4;

        const {tx, strContractAddr} = createContractInvocationTx(nTotalHas, false);
        tx.addReceiver(nChange, generateAddress());

        node._storage.getUtxosCreateMap = sinon.fake();
        node._storage.getContract = sinon.fake.returns(new factory.Contract({groupId}, strContractAddr));

        node._app.processTxInputs = sinon.fake.returns({totalHas: nTotalHas, patch: new factory.PatchDB()});
        node._app.runContract = sinon.fake.returns(new factory.TxReceipt({coinsUsed: 1000}));

        const {fee, patchThisTx} = await node._processTx(false, tx, new factory.PatchDB(groupId));

        assert.equal(fee, nTotalHas - nChange);
        assert.isOk(patchThisTx.getContract(strContractAddr));
        assert.isOk(patchThisTx.getReceipt(tx.hash()));
    });

    it('should use all AVAIL coins as fee (no changeReceiver)', async () => {
        const node = new factory.Node();
        const nTotalHas = 1e5;

        const {tx, strContractAddr} = createContractInvocationTx(nTotalHas, false);

        node._storage.getUtxosCreateMap = sinon.fake();
        node._storage.getContract = sinon.fake.returns(new factory.Contract({groupId}, strContractAddr));

        node._app.processTxInputs = sinon.fake.returns({totalHas: nTotalHas, patch: new factory.PatchDB()});
        node._app.runContract = sinon.fake.returns(new factory.TxReceipt({coinsUsed: 1000}));

        const {fee, patchThisTx} = await node._processTx(false, tx, new factory.PatchDB(groupId));

        assert.equal(fee, nTotalHas);
        assert.isOk(patchThisTx.getContract(strContractAddr));
        assert.isOk(patchThisTx.getReceipt(tx.hash()));
    });

    it('should invoke contract in Genesis block', async () => {
        const node = new factory.Node();
        const buffContractAddr = generateAddress();

        node._storage.getContract =
            sinon.fake.returns(new factory.Contract({groupId}, buffContractAddr.toString('hex')));
        node._app.runContract = sinon.fake.returns(new factory.TxReceipt({coinsUsed: 1000}));

        const tx = new factory.Transaction();
        tx.witnessGroupId = groupId;
        tx.addInput(pseudoRandomBuffer(), 12);
        tx.invokeContract(generateAddress(), '', 0, 1000, generateAddress());

        const patch = new factory.PatchDB(groupId);
        patch.getContract = sinon.fake.returns(undefined);

        await node._processTx(true, tx, patch);

        assert.isOk(patch.getContract.calledOnce);
        assert.isOk(node._storage.getContract.calledOnce);
        assert.isOk(node._app.runContract.calledOnce);
    });

    it('should create internal TX', async () => {
        const node = new factory.Node();
        const address = generateAddress();
        const amount = 1000;
        const patch = new factory.PatchDB();

        const strHash = node._createInternalTx(address, amount, patch);

        const utxo = patch.getUtxo(strHash);
        assert.isOk(utxo);
        assert.isNotOk(utxo.isEmpty());
        assert.deepEqual(utxo.getIndexes(), [0]);
        const coins = utxo.coinsAtIndex(0);
        assert.isOk(coins);
        assert.equal(coins.getAmount(), amount);
        assert.isOk(address.equals(coins.getReceiverAddr()));
    });

    it('should REPLACE LAST_APPLIED_BLOCKS', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        node._storage.getWitnessGroupsCount = sinon.fake.returns(11);

        const block1 = createDummyBlock(factory, 0);
        const block2 = createDummyBlock(factory, 1);
        const block3 = createDummyBlock(factory, 10);

        // add them to dag
        node._mainDag.addBlock(new factory.BlockInfo(block1.header));
        node._mainDag.addBlock(new factory.BlockInfo(block2.header));
        node._mainDag.addBlock(new factory.BlockInfo(block3.header));

        const arrLastBlocks = [block2.getHash(), block1.getHash(), block3.getHash()];
        await node._updateLastAppliedBlocks(arrLastBlocks);

        // replace group 1 & 10 with new blocks
        const block4 = createDummyBlock(factory, 1);
        const block5 = createDummyBlock(factory, 10);

        // and add new for group 5
        const block6 = createDummyBlock(factory, 5);

        // add them to dag
        node._mainDag.addBlock(new factory.BlockInfo(block4.header));
        node._mainDag.addBlock(new factory.BlockInfo(block5.header));
        node._mainDag.addBlock(new factory.BlockInfo(block6.header));

        await node._updateLastAppliedBlocks([block4.getHash(), block5.getHash(), block6.getHash()]);

        const arrExpected = [block1.getHash(), block4.getHash(), block5.getHash(), block6.getHash()];
        const arrFetched = await node._storage.getLastAppliedBlockHashes();
        assert.isOk(arrayEquals(arrFetched, arrExpected));
    });

    it('should NOT notify WS subscribes about new block (RPC is off)', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();
        const block = createDummyBlock(factory);

        node._postAcceptBlock(block);
    });

    it('should NOTIFY WS subscribes about new block (RPC is on)', async () => {
        const node = new factory.Node({rpcAddress: factory.Transport.generateAddress()});
        await node.ensureLoaded();
        const block = createDummyBlock(factory);

        const fake = sinon.fake();
        node._rpc.informWsSubscribers = fake;
        node._postAcceptBlock(block);

        assert.isOk(fake.calledOnce);
        const [topic, objData] = fake.args[0];

        assert.equal(topic, 'newBlock');
        assert.deepEqual(objData, block.header);
    });

    it('should SKIP requesting already requested items (_handleInvMessage)', async () => {
        const fakePeer = {pushMessage: sinon.fake()};
        const msgInv = new factory.Messages.MsgInv();

        const inv = new factory.Inventory();
        inv.addTxHash(pseudoRandomBuffer());
        inv.addTxHash(pseudoRandomBuffer());
        inv.addBlockHash(pseudoRandomBuffer());
        inv.addBlockHash(pseudoRandomBuffer());
        msgInv.inventory = inv;

        const node = new factory.Node({rpcAddress: factory.Transport.generateAddress()});
        await node.ensureLoaded();
        node._requestCache.isRequested = sinon.fake.returns(true);

        await node._handleInvMessage(fakePeer, msgInv);

        assert.equal(node._requestCache.isRequested.callCount, 4);
        assert.equal(fakePeer.pushMessage.callCount, 0);
    });

    it('should REQUEST all items (_handleInvMessage)', async () => {
        const fakePeer = {pushMessage: sinon.fake()};
        const msgInv = new factory.Messages.MsgInv();

        const inv = new factory.Inventory();
        inv.addTxHash(pseudoRandomBuffer());
        inv.addBlockHash(pseudoRandomBuffer());
        inv.addBlockHash(pseudoRandomBuffer());
        msgInv.inventory = inv;

        const node = new factory.Node({rpcAddress: factory.Transport.generateAddress()});
        await node.ensureLoaded();
        node._requestCache.isRequested = sinon.fake.returns(false);

        await node._handleInvMessage(fakePeer, msgInv);

        assert.equal(node._requestCache.isRequested.callCount, 3);
        assert.equal(fakePeer.pushMessage.callCount, 1);
        const [msgGetData] = fakePeer.pushMessage.args[0];
        assert.equal(msgGetData.inventory.vector.length, 3);
    });

    it('should return GENESIS for empty MSG_GET_BLOCKS request', async () => {
        const node = new factory.Node({rpcAddress: factory.Transport.generateAddress()});
        await node.ensureLoaded();

        const setResult = node._getBlocksFromLastKnown([]);
        assert.isOk(setResult);
        assert.equal(setResult.size, 1);
        assert.isOk(setResult.has(factory.Constants.GENESIS_BLOCK));
    });

    it('should return CHAIN for MSG_GET_BLOCKS request', async () => {
        const node = new factory.Node({rpcAddress: factory.Transport.generateAddress()});
        await node.ensureLoaded();

        const arrExpectedHashes = await createSimpleChain(
            block => node._mainDag.addBlock(new factory.BlockInfo(block.header))
        );

        const setResult = node._getBlocksFromLastKnown([]);
        assert.isOk(setResult);
        assert.equal(setResult.size, 10);
        assert.deepEqual(arrExpectedHashes, [...setResult]);
    });

    it('should return FORK for MSG_GET_BLOCKS request', async () => {
        const node = new factory.Node({rpcAddress: factory.Transport.generateAddress()});
        await node.ensureLoaded();

        const arrExpectedHashes = await createSimpleFork(
            block => node._mainDag.addBlock(new factory.BlockInfo(block.header))
        );

        const setResult = node._getBlocksFromLastKnown([]);
        assert.isOk(setResult);
        assert.equal(setResult.size, 4);
        assert.deepEqual(arrExpectedHashes, [...setResult]);
    });

    describe('RPC tests', () => {
        it('should get TX receipt', async () => {
            const node = new factory.Node();
            await node.ensureLoaded();

            const buffContractAddr = generateAddress();
            const strUtxoHash = pseudoRandomBuffer().toString('hex');
            const coinsUsed = 1e5;

            const rcpt = new factory.TxReceipt({
                contractAddress: buffContractAddr,
                coinsUsed
            });
            node._storage.getTxReceipt = sinon.fake.resolves(rcpt);

            const cTxReceipt = await node.rpcHandler({
                event: 'txReceipt',
                content: strUtxoHash
            });

            const objTxReceipt = prepareForStringifyObject(cTxReceipt.toObject());

            assert.isOk(objTxReceipt);
            assert.equal(rcpt.getCoinsUsed(), objTxReceipt.coinsUsed);
            assert.equal(rcpt.getContractAddress(), objTxReceipt.contractAddress);
        });

        it('should get block', async () => {
            const node = new factory.Node();
            await node.ensureLoaded();
            const strBlockHash = pseudoRandomBuffer().toString('hex');
            const cBlock = createDummyBlock(factory);

            const fake = sinon.fake.resolves(cBlock);
            node._storage.getBlock = fake;
            const objResult = await node.rpcHandler({event: 'getBlock', content: strBlockHash});

            assert.isOk(fake.calledOnce);
            const [strHash] = fake.args[0];
            assert.equal(strHash, strBlockHash);

            assert.isOk(objResult);
            assert.deepEqual(prepareForStringifyObject(objResult), prepareForStringifyObject(cBlock.toObject()));
        });

        it('should get TIPS', async () => {
            const node = new factory.Node();
            await node.ensureLoaded();

            const arrExpectedHashes = await createSimpleChain(
                block => {
                    node._pendingBlocks.addBlock(block, new factory.PatchDB());
                    node._mainDag.addBlock(new factory.BlockInfo(block.header));
                }
            );

            const [cOneTip] = await node.rpcHandler({event: 'getTips'});
            assert.isOk(cOneTip);
            assert.deepEqual(
                prepareForStringifyObject(node._mainDag.getBlockInfo(arrExpectedHashes[9])),
                prepareForStringifyObject(cOneTip)
            );
        });

    });

});

