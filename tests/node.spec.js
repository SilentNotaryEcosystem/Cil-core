'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();
const {arrayEquals, prepareForStringifyObject} = require('../utils');

process.on('warning', e => console.warn(e.stack));

const factory = require('./testFactory');
const {
    createDummyTx,
    createDummyPeer,
    createDummyBlock,
    createDummyBlockWithTx,
    createDummyBlockInfo,
    pseudoRandomBuffer,
    generateAddress
} = require('./testUtil');

let seedAddress;
let seedNode;

const groupId = 10;

const createContractInvocationTx = (code = {}, hasChangeReceiver = true) => {
    const contractAddr = generateAddress().toString('hex');

    // prepare tx (for non genesis block)
    let tx;

    if (hasChangeReceiver) {
        tx = factory.Transaction.invokeContract(contractAddr, code, 0, generateAddress());
    } else {
        tx = factory.Transaction.invokeContract(contractAddr, code, 0);
    }
    tx.witnessGroupId = groupId;
    tx.addInput(pseudoRandomBuffer(), 12);

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
    tx.claim(0, keyPair.privateKey);

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
        block.finish(factory.Constants.fees.TX_FEE, pseudoRandomBuffer(33));

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
        block.finish(factory.Constants.fees.TX_FEE, pseudoRandomBuffer(33));

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
        node.rpc.sendRawTx({strTx: tx.encode().toString('hex')});
        await donePromise;
    });

    it('should process NEW block from MsgBlock', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();
        const fakePeer = {fake: 1};

        const block = createDummyBlock(factory);
        const msg = new factory.Messages.MsgBlock(block);

        node._requestCache.request(block.hash());
        node._mainDag.getBlockInfo = sinon.fake.returns(false);
        node._verifyBlock = sinon.fake.resolves(true);
        node._blockInFlight = sinon.fake();

        await node._handleBlockMessage(fakePeer, msg);

        assert.equal(node._mapBlocksToExec.size, 1);
        assert.deepEqual(node._mapBlocksToExec.get(block.getHash()), fakePeer);
    });

    it('should omit KNOWN block from MsgBlock', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();

        const block = createDummyBlock(factory);
        const msg = new factory.Messages.MsgBlock(block);
        node._requestCache.request(block.hash());
        node._mainDag.getBlockInfo = sinon.fake.resolves(true);

        await node._handleBlockMessage(undefined, msg);

        assert.equal(node._mapBlocksToExec.size, 0);
    });

    it('should discard INVALID block from MsgBlock', async () => {
        const block = createDummyBlockWithTx(factory);

        const groupDef = createGroupDefAndSignBlock(block);
        const node = new factory.Node({arrTestDefinition: [groupDef]});
        await node.ensureLoaded();

        node._requestCache.request(block.hash());
        node._mainDag.getBlockInfo = sinon.fake.returns(false);
        node._verifyBlock = sinon.fake.throws('error');

        try {
            await node._handleBlockMessage(peer, msg);
        } catch (e) {
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
        tx.claim(0, keyPair.privateKey);

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
        tx.claim(0, keyPair.privateKey);

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
        block.finish(factory.Constants.fees.TX_FEE, pseudoRandomBuffer(33));

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
        await node._buildMainDag([], arrPendingHashes);
        assert.equal(node._mainDag.order, 0);
        assert.equal(node._mainDag.size, 0);
    });

    it('should build MainDag from chainlike', async () => {
        const node = new factory.Node();

        const arrHashes = await createSimpleChain(async block => await node._storage.saveBlock(block));
        await node._storage.updateLastAppliedBlocks([arrHashes[8]]);
        await node._storage.updatePendingBlocks([arrHashes[9]]);

        const arrPendingHashes = await node._storage.getPendingBlockHashes();
        await node._buildMainDag([], arrPendingHashes);

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
        await node._buildMainDag([], arrPendingHashes);

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

    it('should build MainDag from single Genesis (stable)', async () => {
        const node = new factory.Node();
        const block = createDummyBlock(factory);

        node._storage.getBlockInfo = sinon.fake.resolves(new factory.BlockInfo(block.header));
        factory.Constants.GENESIS_BLOCK = block.getHash();

        await node._buildMainDag([block.getHash()], []);
        assert.equal(node._mainDag.order, 1);
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
        await node._peerManager.addPeer(newPeer);

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
            peer.fullyConnected = false;
            node._peerManager.addPeer(peer);
        });
        await node._reconnectPeers();
        assert.equal(connectToPeer.callCount, 3);
        assert.equal(pushMessage.callCount, 3);
    });

    it('should create internal TX', async () => {
        const node = new factory.Node();
        const address = generateAddress();
        const amount = 1000;
        const patch = new factory.PatchDB();

        const strHash = node._createInternalTx(patch, address, amount);

        const utxo = patch.getUtxo(strHash);
        assert.isOk(utxo);
        assert.isNotOk(utxo.isEmpty());
        assert.deepEqual(utxo.getIndexes(), [0]);
        const coins = utxo.coinsAtIndex(0);
        assert.isOk(coins);
        assert.equal(coins.getAmount(), amount);
        assert.isOk(address.equals(coins.getReceiverAddr()));
    });

    it('should CREATE LAST_APPLIED_BLOCKS', async () => {
        const node = new factory.Node();
        await node.ensureLoaded();
        node._storage.updateLastAppliedBlocks = sinon.fake();

        const block = createDummyBlock(factory, 0);
        node._mainDag.getBlockInfo = sinon.fake.returns(new factory.BlockInfo(block.header));

        await node._updateLastAppliedBlocks([block.getHash()]);

        assert.isOk(node._storage.updateLastAppliedBlocks.calledOnce);

        const [arrHashes] = node._storage.updateLastAppliedBlocks.args[0];
        assert.isOk(arrHashes);
        assert.equal(arrHashes.length, 1);
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
        assert.deepEqual(objData, block);
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

        assert.equal(fakePeer.pushMessage.callCount, 1);
        const [msgGetData] = fakePeer.pushMessage.args[0];
        assert.equal(msgGetData.inventory.vector.length, 3);
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

            const state = 21;
            const cBlock = createDummyBlock(factory);
            const getBlockFake = sinon.fake.resolves({block: cBlock, state});
            node._getBlockAndState = getBlockFake;

            const objResult = await node.rpcHandler({event: 'getBlock', content: cBlock.getHash()});

            assert.isOk(getBlockFake.calledOnce);

            assert.isOk(objResult);
            assert.deepEqual(
                prepareForStringifyObject(objResult),
                {
                    block: prepareForStringifyObject(cBlock),
                    state
                }
            );
        });

        it('should get TIPS', async () => {
            const node = new factory.Node();
            await node.ensureLoaded();

            const arrExpectedHashes = await createSimpleChain(
                block => {
                    node._pendingBlocks.addBlock(block, new factory.PatchDB());
                    const bi = new factory.BlockInfo(block.header);
                    bi.markAsFinal();
                    node._mainDag.addBlock(bi);
                }
            );

            node._storage.getBlock = sinon.fake.resolves(node._mainDag.getBlockInfo(arrExpectedHashes[9]));

            const [objOneTip] = await node.rpcHandler({event: 'getTips'});
            assert.isOk(objOneTip);
            assert.deepEqual(
                prepareForStringifyObject(objOneTip),
                {
                    block: prepareForStringifyObject(node._mainDag.getBlockInfo(arrExpectedHashes[9])),

                    // FINAL_BLOCK @see BlockInfo.js
                    state: 8
                }
            );
        });

        it('should get one TIP', async () => {
            const node = new factory.Node();
            await node.ensureLoaded();

            const block = createDummyBlock(factory);
            const state = 12;

            const expectedResult = {
                block: prepareForStringifyObject(block),
                state
            };

            node._storage.getLastAppliedBlockHashes = sinon.fake.resolves(['dead']);
            node._getBlockAndState = sinon.fake.resolves({
                block: prepareForStringifyObject(block),
                state
            });

            const [objOneTip] = await node.rpcHandler({event: 'getTips'});
            assert.isOk(objOneTip);
            assert.deepEqual(expectedResult, objOneTip);
        });

        it('should fail to get TX', (done) => {
            const node = new factory.Node();

            const block = createDummyBlockWithTx(factory);
            const strTxHash = block.getTxHashes()[0];

            node._storage.findBlockByTxHash = sinon.fake.throws('Block not found');

            node.rpcHandler({
                    event: 'getTx',
                    content: strTxHash
                })
                .then(_ => done('Unexpected success'))
                .catch(_ => done());
        });

        it('should fail to get UTXO', async () => {
            const strTxHash = pseudoRandomBuffer().toString('hex');
            const createDummyUtxo = (arrIndexes) => {
                const utxo = new factory.UTXO({txHash: strTxHash});
                const coins = new factory.Coins(10, generateAddress());
                arrIndexes.forEach(idx => utxo.addCoins(idx, coins));
                return utxo;
            };

            const node = new factory.Node();
            node._storage.getUtxo = sinon.fake.resolves(createDummyUtxo([1, 5, 10]));

            const objResult = await node.rpcHandler({
                event: 'getUnspent',
                content: strTxHash
            });
            assert.isOk(arrayEquals(Object.keys(objResult).map(key => parseInt(key)), [1, 5, 10]));
            assert.isOk(Object.keys(objResult).every(key => typeof objResult[key].amount === 'number' &&
                                                            typeof objResult[key].receiverAddr === 'string'));
        });

        describe('getTX', async () => {
            let node;
            let strHash;

            beforeEach(async () => {
                node = new factory.Node();
                await node.ensureLoaded();

                strHash = pseudoRandomBuffer().toString('hex');
            });

            it('should get TX from mempool', async () => {
                const fakeTx = {a: 1};

                node._mempool.hasTx = sinon.fake.returns(true);
                node._mempool.getTx = sinon.fake.returns(fakeTx);

                const {tx, status, block} = await node.rpcHandler({
                    event: 'getTx',
                    content: strHash
                });

                assert.equal(status, 'mempool');
                assert.deepEqual(tx, fakeTx);
                assert.isNotOk(block);
            });

            it('should get TX status final', async () => {
                const block = createDummyBlockWithTx(factory);
                const strTxHash = block.getTxHashes()[0];

                node._storage.findBlockByTxHash = sinon.fake.resolves(block);

                const {tx, status, block: foundBlock} = await node.rpcHandler({
                    event: 'getTx',
                    content: strTxHash
                });

                assert.equal(status, 'confirmed');
                assert.deepEqual(tx, block.txns[0]);
                assert.equal(foundBlock, block.getHash());
            });

            it('should get TX status pending', async () => {
                const block = createDummyBlockWithTx(factory);
                const strTxHash = block.getTxHashes()[0];

                node._storage.findBlockByTxHash = sinon.fake.resolves(block);
                node._pendingBlocks.hasBlock = sinon.fake.returns(true);

                const {tx, status, block: foundBlock} = await node.rpcHandler({
                    event: 'getTx',
                    content: strTxHash
                });

                assert.equal(status, 'in block');
                assert.deepEqual(tx, block.txns[0]);
                assert.equal(foundBlock, block.getHash());
            });

            it('should not find TX', async () => {
                node._storage.findBlockByTxHash = sinon.fake.resolves(undefined);

                const {tx, status, block} = await node.rpcHandler({
                    event: 'getTx',
                    content: strHash
                });

                assert.equal(status, 'unknown');
                assert.isNotOk(tx);
                assert.isNotOk(block);
            });
        });

        describe('constantMethodCall', async () => {
            let node;

            beforeEach(async () => {
                node = new factory.Node();
                await node.ensureLoaded();
            });

            it('should prefer PENDING contract data', async () => {
                const expectedResult = {a: 23, z: 17};
                const pendingData = {a: 10, b: 20};
                const contractPending = new factory.Contract({
                    contractData: {sampleResult: pendingData},
                    contractCode: `{"test": "() {return this.sampleResult;}"}`,
                    groupId
                }, generateAddress().toString('hex'));

                const stableData = {a: 100, b: 200};
                const contractStable = new factory.Contract({
                    contractData: {sampleResult: stableData},
                    contractCode: `{"test": "() {return this.sampleResult;}"}`,
                    groupId
                }, generateAddress().toString('hex'));

                node._storage.getContract = sinon.fake.resolves(contractStable);
                node._pendingBlocks.getContract = sinon.fake.returns(contractPending);
                node._app.runContract = sinon.fake.resolves(expectedResult);

                const result = await node._constantMethodCallRpc({
                    method: 'test',
                    arrArguments: [],
                    contractAddress: generateAddress().toString('hex')
                });

                assert.deepEqual(result, expectedResult);
                assert.isOk(node._app.runContract.calledOnce);
                const [, , contract] = node._app.runContract.args[0];
                assert.deepEqual(contract.getData(), {sampleResult: pendingData});
            });

            it('should prefer STABLE contract data', async () => {
                const expectedResult = {a: 23, z: 17};
                const pendingData = {a: 10, b: 20};
                const contractPending = new factory.Contract({
                    contractData: {sampleResult: pendingData},
                    contractCode: `{"test": "() {return this.sampleResult;}"}`,
                    groupId
                }, generateAddress().toString('hex'));

                const stableData = {a: 100, b: 200};
                const contractStable = new factory.Contract({
                    contractData: {sampleResult: stableData},
                    contractCode: `{"test": "() {return this.sampleResult;}"}`,
                    groupId
                }, generateAddress().toString('hex'));

                node._storage.getContract = sinon.fake.resolves(contractStable);
                node._pendingBlocks.getContract = sinon.fake.returns(contractPending);
                node._app.runContract = sinon.fake.resolves(expectedResult);

                const result = await node._constantMethodCallRpc({
                    method: 'test',
                    arrArguments: [],
                    contractAddress: generateAddress().toString('hex'),
                    completed: true
                });

                assert.deepEqual(result, expectedResult);
                assert.isOk(node._app.runContract.calledOnce);
                const [, , contract] = node._app.runContract.args[0];
                assert.deepEqual(contract.getData(), {sampleResult: stableData});
            });
        });

        describe('walletListUnspent', async () => {
            let node;
            let utxo1;
            let utxo2;
            let addr;
            let coins;

            beforeEach(async () => {
                node = new factory.Node();
                await node.ensureLoaded();

                addr = generateAddress();
                coins = new factory.Coins(1e5, addr);

                const arrOutputs = [0, 5, 2];

                // stable TXns
                utxo1 = new factory.UTXO({txHash: pseudoRandomBuffer()});
                utxo1.addCoins(arrOutputs[0], coins);
                utxo1.addCoins(arrOutputs[1], coins);
                utxo1.addCoins(arrOutputs[2], coins);
                node._storage.walletListUnspent = sinon.fake.resolves([utxo1]);

                // pending TXns
                utxo2 = new factory.UTXO({txHash: pseudoRandomBuffer()});
                utxo2.addCoins(arrOutputs[0], coins);
                utxo2.addCoins(arrOutputs[1], coins);
                utxo2.addCoins(arrOutputs[2], coins);

                const patchPending = new factory.PatchDB();
                patchPending.setUtxo(utxo2);
                node._pendingBlocks.getBestParents = sinon.fake.resolves({patchMerged: patchPending});

            });

            it('should get only stable UTXOS', async () => {
                const {arrStableUtxos, arrPendingUtxos} = await node.rpcHandler(
                    {
                        event: 'walletListUnspent',
                        content: {
                            strAddress: addr.toString('hex'),
                            bStableOnly: true
                        }
                    });
                assert.isOk(Array.isArray(arrStableUtxos));
                assert.equal(arrStableUtxos.length, 1);

                assert.isOk(Array.isArray(arrPendingUtxos));
                assert.equal(arrPendingUtxos.length, 0);
            });

            it('should get all UTXOS (including pending)', async () => {
                const {arrStableUtxos, arrPendingUtxos} = await node.rpcHandler(
                    {
                        event: 'walletListUnspent',
                        content: {
                            strAddress: addr.toString('hex'),
                            bStableOnly: false
                        }
                    });

                assert.isOk(Array.isArray(arrStableUtxos));
                assert.equal(arrStableUtxos.length, 1);

                assert.isOk(Array.isArray(arrPendingUtxos));
                assert.equal(arrPendingUtxos.length, 1);
            });
        });
    });

    describe('BlockProcessor', () => {
        let node;
        beforeEach(async () => {
            node = new factory.Node();
            await node.ensureLoaded();
        });

        describe('_storeBlockAndInfo', () => {
            it('should rewrite BlockInfo and remove block from storage (we mark it as bad)', async () => {
                const bi = createDummyBlockInfo(factory);
                const badBi = new factory.BlockInfo(bi.encode());
                badBi.markAsBad();

                node._storage.getBlockInfo = sinon.fake.resolves(bi);
                node._storage.saveBlockInfo = sinon.fake();
                node._storage.removeBlock = sinon.fake();

                await node._storeBlockAndInfo(undefined, badBi);

                assert.isOk(node._storage.getBlockInfo.calledOnce);
                assert.isOk(node._storage.saveBlockInfo.calledOnce);
                assert.isOk(node._storage.removeBlock.calledOnce);

            });

            it('should save only BlockInfo (no previously stored block)', async () => {
                const badBi = createDummyBlockInfo(factory);
                badBi.markAsBad();

                node._storage.getBlockInfo = sinon.fake.rejects('err');
                node._storage.saveBlockInfo = sinon.fake();
                node._storage.removeBlock = sinon.fake();

                await node._storeBlockAndInfo(undefined, badBi);

                assert.isOk(node._storage.getBlockInfo.calledOnce);
                assert.isOk(node._storage.saveBlockInfo.calledOnce);
                assert.isNotOk(node._storage.removeBlock.calledOnce);

            });

            it('should save both: BlockInfo & Block (good block)', async () => {
                const block = createDummyBlock(factory);
                const bi = new factory.BlockInfo(block.header);

                node._storage.saveBlock = sinon.fake.resolves();

                await node._storeBlockAndInfo(block, bi);

                assert.isOk(node._storage.saveBlock.calledOnce);
            });
        });

        describe('_isBlockKnown', () => {
            it('should be Ok (in DAG)', async () => {
                node._mainDag.getBlockInfo = sinon.fake.returns(true);
                assert.isOk(await node._isBlockKnown('hash'));
            });
            it('should be Ok (in storage)', async () => {
                node._mainDag.getBlockInfo = sinon.fake.returns(false);
                node._storage.hasBlock = sinon.fake.resolves(new factory.Block(0));
                assert.isOk(await node._isBlockKnown('hash'));
            });
        });
        describe('_isBlockExecuted', () => {
            it('should be Ok (final block is in DAG)', async () => {
                node._mainDag.getBlockInfo = sinon.fake.returns({isFinal: () => true});
                assert.isOk(node._isBlockExecuted('hash'));
            });
            it('should be Ok (final block is in DAG)', async () => {
                node._mainDag.getBlockInfo = sinon.fake.returns(undefined);
                node._pendingBlocks.hasBlock = sinon.fake.returns(true);
                assert.isOk(node._isBlockExecuted('hash'));
            });
        });

        describe('_createMapBlockPeer', () => {
            it('should query all hashes from one peer', async () => {
                const peer = {address: 'addr1', port: 1234};
                node._mapUnknownBlocks = new Map();
                node._mapUnknownBlocks.set(pseudoRandomBuffer().toString('hex'), peer);
                node._mapUnknownBlocks.set(pseudoRandomBuffer().toString('hex'), peer);
                node._mapUnknownBlocks.set(pseudoRandomBuffer().toString('hex'), peer);

                const resultMap = node._createMapBlockPeer();
                assert.isOk(resultMap);
                assert.equal(resultMap.size, 1);
                const [[, setHashes]] = [...resultMap];
                assert.equal(setHashes.size, 3);
            });
            it('should query all hashes from different peer', async () => {
                const peer = {address: 'addr1', port: 1234};
                const peer2 = {address: 'addr2', port: 1234};
                const peer3 = {address: 'addr3', port: 1234};
                node._mapUnknownBlocks = new Map();
                node._mapUnknownBlocks.set(pseudoRandomBuffer().toString('hex'), peer);
                node._mapUnknownBlocks.set(pseudoRandomBuffer().toString('hex'), peer2);
                node._mapUnknownBlocks.set(pseudoRandomBuffer().toString('hex'), peer3);

                const resultMap = node._createMapBlockPeer();
                assert.isOk(resultMap);
                assert.equal(resultMap.size, 3);
            });
        });

        describe('_sendMsgGetDataToPeers', () => {
            let mapBlockPeers;
            const peer = {address: 'addr1', port: 1234};
            const peer2 = {address: 'addr2', port: 1234};
            const peer3 = {address: 'addr3', port: 1234};

            beforeEach(() => {

                node._mapUnknownBlocks = new Map();
                node._mapUnknownBlocks.set(pseudoRandomBuffer().toString('hex'), peer);
                node._mapUnknownBlocks.set(pseudoRandomBuffer().toString('hex'), peer2);
                node._mapUnknownBlocks.set(pseudoRandomBuffer().toString('hex'), peer2);
                node._mapUnknownBlocks.set(pseudoRandomBuffer().toString('hex'), peer2);
                node._mapUnknownBlocks.set(pseudoRandomBuffer().toString('hex'), peer3);

                [peer, peer2, peer3].forEach(p => p.pushMessage = sinon.fake());

                mapBlockPeers = node._createMapBlockPeer();
            });

            it('should do nothing since no connected peers', async () => {
                node._peerManager.getConnectedPeers = sinon.fake.returns([]);
                const map = new Map([['key', 'value']]);
                await node._sendMsgGetDataToPeers(map);
            });

            it('should request all hashes', async () => {
                node._peerManager.getConnectedPeers = sinon.fake.returns([peer, peer2, peer3]);
                await node._sendMsgGetDataToPeers(mapBlockPeers);

                assert.isOk(peer.pushMessage.calledOnce);
                assert.isOk(peer2.pushMessage.calledOnce);
                assert.isOk(peer3.pushMessage.calledOnce);

                {
                    const [msg] = peer.pushMessage.args[0];
                    assert.equal(msg.inventory.vector.length, 1);
                }
                {
                    const [msg] = peer2.pushMessage.args[0];
                    assert.equal(msg.inventory.vector.length, 3);
                }
                {
                    const [msg] = peer3.pushMessage.args[0];
                    assert.equal(msg.inventory.vector.length, 1);
                }
            });
        });

        describe('_blockProcessorExecBlock', () => {
            it('should process from hash (fail to exec)', async () => {
                const peer = {misbehave: sinon.fake()};
                node._storage.getBlock = sinon.fake.resolves(createDummyBlock(factory));
                node._execBlock = sinon.fake.throws(new Error('error'));
                node._blockBad = sinon.fake();

                await node._blockProcessorExecBlock(pseudoRandomBuffer(), peer);
                assert.isOk(node._blockBad.calledOnce);
                assert.isOk(peer.misbehave.calledOnce);
            });

            it('should process from block (fail to exec)', async () => {
                const peer = {misbehave: sinon.fake()};
                node._storage.getBlock = sinon.fake();
                node._execBlock = sinon.fake.throws(new Error('error'));
                node._blockBad = sinon.fake();

                await node._blockProcessorExecBlock(createDummyBlock(factory), peer);
                assert.isNotOk(node._storage.getBlock.called);
                assert.isOk(node._blockBad.calledOnce);
            });
        });

        describe('_blockProcessorProcessParents', () => {
            it('should mark toExec', async () => {
                node._isBlockKnown = sinon.fake.returns(true);
                node._isBlockExecuted = sinon.fake.returns(false);

                const block = createDummyBlock(factory);
                const {arrToRequest, arrToExec} = await node._blockProcessorProcessParents(
                    new factory.BlockInfo(block.header)
                );
                assert.equal(arrToRequest.length, 0);
                assert.equal(arrToExec.length, 1);
            });

            it('should mark toRequest', async () => {
                node._isBlockKnown = sinon.fake.returns(false);

                const block = createDummyBlock(factory);
                const {arrToRequest, arrToExec} = await node._blockProcessorProcessParents(
                    new factory.BlockInfo(block.header)
                );
                assert.equal(arrToRequest.length, 1);
                assert.equal(arrToExec.length, 0);
            });

            it('should do nothing (already executed)', async () => {
                node._isBlockKnown = sinon.fake.returns(true);
                node._isBlockExecuted = sinon.fake.returns(true);

                const block = createDummyBlock(factory);
                const {arrToRequest, arrToExec} = await node._blockProcessorProcessParents(
                    new factory.BlockInfo(block.header)
                );
                assert.equal(arrToRequest.length, 0);
                assert.equal(arrToExec.length, 0);
            });
        });

    });

    describe('_createCallbacksForApp', () => {
        let node;
        beforeEach(async () => {
            node = new factory.Node();
            await node.ensureLoaded();
        });

        it('should properly bind context & pass args for _createInternalTx', async () => {
            const patchTx = new factory.PatchDB();
            const strTxHash = pseudoRandomBuffer().toString('hex');

            node._createInternalTx = sinon.fake.returns(pseudoRandomBuffer().toString('hex'));
            const {createInternalTx} = node._createCallbacksForApp(undefined, patchTx, strTxHash);

            const strAddress = generateAddress().toString('hex');
            const nAmount = 100;
            createInternalTx(strAddress, nAmount);

            assert.isOk(node._createInternalTx.calledOnce);
            const [patchTxArg, strAddrArg, nAmountArg] = node._createInternalTx.args[0];
            assert.isOk(patchTxArg && patchTxArg instanceof factory.PatchDB);
            assert.equal(strAddrArg, strAddress);
            assert.equal(nAmountArg, nAmount);
        });

        it('should properly bind context & pass args for _invokeNestedContract', async () => {
            const strTxHash = pseudoRandomBuffer().toString('hex');

            node._invokeNestedContract = sinon.fake();
            const {invokeContract} = node._createCallbacksForApp(
                new factory.PatchDB(), new factory.PatchDB(),
                strTxHash
            );

            const arrArguments = [1, 2, 3, 4];
            const method = 'test';
            const strAddress = generateAddress().toString('hex');
            invokeContract(strAddress.toString('hex'), {method, arrArguments});

            assert.isOk(node._invokeNestedContract.calledOnce);
            const [patchBlockArg, patchTxArg, strTxHashArg, strAddrArg, {method: methodArg, arrArguments: arrArgumentsArg}] = node._invokeNestedContract.args[0];
            assert.isOk(patchBlockArg && patchBlockArg instanceof factory.PatchDB);
            assert.isOk(patchTxArg && patchTxArg instanceof factory.PatchDB);
            assert.equal(strAddress, strAddrArg);
            assert.equal(methodArg, method);
            assert.equal(strTxHashArg, strTxHash);
            assert.deepEqual(arrArgumentsArg, arrArguments);
        });
    });

    describe('Contracts', async () => {
        it('should get contact from Patch', async () => {
            const node = new factory.Node();
            const {tx} = createContractInvocationTx();
            const patch = new factory.PatchDB(groupId);

            patch.getContract = sinon.fake.returns(new factory.Contract({groupId}));
            node._storage.getContract = sinon.fake();

            const contract = await node._getContractByAddr(tx.getContractAddr(), patch);
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

            const contract = await node._getContractByAddr(tx.getContractAddr(), patch);
            assert.isOk(contract);
            assert.isOk(patch.getContract.calledOnce);
            assert.isOk(node._storage.getContract.calledOnce);
        });

        it('should return contract FOR MONEY TRANSFER to contract address (from Patch)', async () => {
            const node = new factory.Node();
            const buffContractAddr = generateAddress();

            const patch = new factory.PatchDB();
            patch.getContract = () => new factory.Contract({});

            const tx = new factory.Transaction();
            tx.addReceiver(1000, buffContractAddr);

            assert.isOk(await node._getContractByAddr(tx.getContractAddr(), patch));
        });

        it('should return contract FOR MONEY TRANSFER to contract address (from Storage)', async () => {
            const node = new factory.Node();
            node._storage.getContract = () => new factory.Contract({});

            const buffContractAddr = generateAddress();

            const patch = new factory.PatchDB();
            patch.getContract = () => undefined;

            const tx = new factory.Transaction();
            tx.addReceiver(1000, buffContractAddr);

            assert.isOk(await node._getContractByAddr(tx.getContractAddr(), patch));
        });

        it('should call createContract', async () => {
            const node = new factory.Node();
            const tx = factory.Transaction.createContract(
                'class A extends Base{}',
                generateAddress()
            );

            const contract = new factory.Contract({});
            contract.storeAddress(generateAddress());
            node._app.createContract = sinon.fake.returns({
                contract,
                receipt: new factory.TxReceipt({coinsUsed: 1000, status: factory.Constants.TX_STATUS_OK})
            });

            // mark it as Genesis block TX (it skip many checks, like signatures & inputs)
            await node._processTx(undefined, true, tx);

            assert.isOk(node._app.createContract.called);
        });

        it('should call runContract', async () => {
            const node = new factory.Node();
            const contractAddr = generateAddress();
            const groupId = 10;

            const {tx} = createContractInvocationTx();

            node._storage.getContract =
                sinon.fake.returns(new factory.Contract({groupId}, contractAddr.toString('hex')));
            node._app.runContract =
                sinon.fake.returns(new factory.TxReceipt({coinsUsed: 1000, status: factory.Constants.TX_STATUS_OK}));

            // mark it as Genesis block TX (it skip many checks, like signatures & inputs)
            await node._processTx(undefined, true, tx);

            assert.isOk(node._app.runContract.calledOnce);
            const [coinsLimit, strInvocationCode, contract] = node._app.runContract.args[0];
            assert.equal(coinsLimit, Number.MAX_SAFE_INTEGER);
            assert.isOk(typeof strInvocationCode === 'object');
            assert.isOk(contract instanceof factory.Contract);
        });

        it('should FAIL to invoke contract (small fee)', async () => {
            const node = new factory.Node();
            const nTotalHas = 1e3;

            const {tx, strContractAddr} = createContractInvocationTx({});

            node._storage.getContract = sinon.fake.returns(new factory.Contract({groupId}, strContractAddr));

            node._app.processTxInputs = sinon.fake.returns({totalHas: nTotalHas, patch: new factory.PatchDB()});
            node._app.runContract = sinon.fake.returns(new factory.TxReceipt({coinsUsed: 1000}));

            try {
                await node._processTx(undefined, false, tx);
            } catch (e) {
                assert.isOk(e.message.match('CONTRACT fee .+ less than .+'));
                return;
            }
            throw new Error('Unexpected success');
        });

        it('should invoke contract with environment', async () => {
            const node = new factory.Node();
            const nTotalHas = 1e5;
            const nChange = 1e4;

            const kp = factory.Crypto.createKeyPair();
            const {tx, strContractAddr} = createContractInvocationTx({});
            tx.addReceiver(nChange, generateAddress());
            tx.signForContract(kp.privateKey);

            node._storage.getContract = sinon.fake.returns(new factory.Contract({groupId}, strContractAddr));

            node._app.processTxInputs = sinon.fake.returns({totalHas: nTotalHas, patch: new factory.PatchDB()});
            node._app.runContract = sinon.fake.returns(
                new factory.TxReceipt({coinsUsed: 1000, status: factory.Constants.TX_STATUS_OK})
            );

            await node._processTx(undefined, false, tx);

            assert.isOk(node._app.runContract.calledOnce);
            const [coinsLimit, strInvocationCode, contract, environment] = node._app.runContract.args[0];
            assert.equal(coinsLimit, nTotalHas - nChange);
            assert.isOk(typeof strInvocationCode === 'object');
            assert.isOk(contract instanceof factory.Contract);

            assert.equal(environment.callerAddress, kp.address);
            assert.equal(environment.contractTx, tx.getHash());
        });

        it('should use all INPUT coins as fee (no changeReceiver no change output)', async () => {
            const node = new factory.Node();
            const nTotalHas = 1e5;
            const nChange = 1e4;
            const coinsUsed = 1000;

            const {tx, strContractAddr} = createContractInvocationTx({});
            tx.addReceiver(nChange, generateAddress());

            node._storage.getContract = sinon.fake.returns(new factory.Contract({groupId}, strContractAddr));

            node._app.processTxInputs = sinon.fake.returns({totalHas: nTotalHas, patch: new factory.PatchDB()});
            node._app.runContract = sinon.fake.returns(
                new factory.TxReceipt({coinsUsed, status: factory.Constants.TX_STATUS_OK})
            );

            const {fee, patchThisTx} = await node._processTx(undefined, false, tx);

            assert.equal(fee, coinsUsed);
            assert.isOk(patchThisTx.getContract(strContractAddr));
            const receipt = patchThisTx.getReceipt(tx.hash());
            assert.isOk(receipt);
            assert.equal(receipt.getInternalTxns().length, 1);
        });

        it('should use all AVAIL coins as fee (no changeReceiver)', async () => {
            const node = new factory.Node();
            const nTotalHas = 1e5;

            const {tx, strContractAddr} = createContractInvocationTx({}, false);

            node._storage.getContract = sinon.fake.returns(new factory.Contract({groupId}, strContractAddr));

            node._app.processTxInputs = sinon.fake.returns({totalHas: nTotalHas, patch: new factory.PatchDB()});
            node._app.runContract = sinon.fake.returns(
                new factory.TxReceipt({coinsUsed: 1000, status: factory.Constants.TX_STATUS_OK})
            );

            const {fee, patchThisTx} = await node._processTx(undefined, false, tx);

            assert.equal(fee, nTotalHas);
            assert.isOk(patchThisTx.getContract(strContractAddr));
            assert.isOk(patchThisTx.getReceipt(tx.hash()));
        });

        it('should invoke contract in Genesis block', async () => {
            const node = new factory.Node();
            const buffContractAddr = generateAddress();

            node._storage.getContract =
                sinon.fake.returns(new factory.Contract({groupId}, buffContractAddr.toString('hex')));
            node._app.runContract =
                sinon.fake.returns(new factory.TxReceipt({coinsUsed: 1000, status: factory.Constants.TX_STATUS_OK}));

            const tx = factory.Transaction.invokeContract(
                generateAddress().toString('hex'),
                {},
                0,
                generateAddress()
            );
            tx.witnessGroupId = groupId;
            tx.addInput(pseudoRandomBuffer(), 12);

            const patch = new factory.PatchDB(groupId);
            patch.getContract = sinon.fake.returns(undefined);

            await node._processTx(patch, true, tx);

            assert.isOk(patch.getContract.calledOnce);
            assert.isOk(node._storage.getContract.calledOnce);
            assert.isOk(node._app.runContract.calledOnce);
        });
    });

    describe('Node bootstrap', () => {
        let node;
        before(() => {
            factory.Constants.GENESIS_BLOCK = pseudoRandomBuffer().toString('hex');
        });

        beforeEach(async () => {
            node = new factory.Node();
            await node.ensureLoaded();
        });

        describe('Empty node', () => {
            it('should return NOTHING for empty REQUEST', async () => {
                const setResult = node._getBlocksFromLastKnown([]);
                assert.equal(setResult.size, 0);
            });

            it('should return NOTHING for some hashes', async () => {
                const setResult = node._getBlocksFromLastKnown(
                    [1, 2, 3].map(_ => pseudoRandomBuffer().toString('hex'))
                );
                assert.equal(setResult.size, 0);
            });

        });
        describe('Node with only Genesis', () => {
            it('should return GENESIS for empty REQUEST', async () => {

                // fake possessing Genesis
                node._mainDag.getBlockInfo = (hash) => hash === factory.Constants.GENESIS_BLOCK;
                const setResult = node._getBlocksFromLastKnown([]);

                assert.isOk(setResult);
                assert.equal(setResult.size, 1);
                assert.isOk(setResult.has(factory.Constants.GENESIS_BLOCK));
            });
            it('should return GENESIS for some hashes', async () => {

                // fake possessing Genesis
                node._mainDag.getBlockInfo = (hash) => hash === factory.Constants.GENESIS_BLOCK;
                const setResult = node._getBlocksFromLastKnown(
                    [1, 2, 3].map(_ => pseudoRandomBuffer().toString('hex'))
                );

                assert.isOk(setResult);
                assert.equal(setResult.size, 1);
                assert.isOk(setResult.has(factory.Constants.GENESIS_BLOCK));
            });

        });
        describe('Some loaded node', () => {

            it('should return CHAIN for empty REQUEST', async () => {

                const arrExpectedHashes = await createSimpleChain(
                    block => node._mainDag.addBlock(new factory.BlockInfo(block.header))
                );

                const setResult = node._getBlocksFromLastKnown([]);
                assert.isOk(setResult);
                assert.equal(setResult.size, 10);
                assert.deepEqual(arrExpectedHashes, [...setResult]);
            });

            it('should return FORK for empty REQUEST', async () => {
                const arrExpectedHashes = await createSimpleFork(
                    block => node._mainDag.addBlock(new factory.BlockInfo(block.header))
                );

                const setResult = node._getBlocksFromLastKnown([]);
                assert.isOk(setResult);
                assert.equal(setResult.size, 4);
                assert.deepEqual(arrExpectedHashes, [...setResult]);
            });

            it('should return EMPTY set for last known hashes (FORK)', async () => {
                const arrExpectedHashes = await createSimpleFork(
                    block => node._mainDag.addBlock(new factory.BlockInfo(block.header))
                );

                const setResult = node._getBlocksFromLastKnown(arrExpectedHashes);
                assert.isOk(setResult);
                assert.equal(setResult.size, 0);
            });

            it('should return EMPTY set for last known hashes (CHAIN)', async () => {
                const arrExpectedHashes = await createSimpleChain(
                    block => node._mainDag.addBlock(new factory.BlockInfo(block.header))
                );

                const setResult = node._getBlocksFromLastKnown(arrExpectedHashes);
                assert.isOk(setResult);
                assert.equal(setResult.size, 0);
            });

            it('should return EMPTY for one wrong ADDITIONAL hash (CHAIN)', async () => {

                const arrExpectedHashes = await createSimpleChain(
                    block => node._mainDag.addBlock(new factory.BlockInfo(block.header))
                );

                const setResult = node._getBlocksFromLastKnown(
                    arrExpectedHashes.concat([pseudoRandomBuffer().toString('hex')])
                );

                assert.isOk(setResult);
                assert.equal(setResult.size, 0);
            });

            it('should return ONE element for last DELETED (CHAIN)', async () => {

                const arrExpectedHashes = await createSimpleChain(
                    block => node._mainDag.addBlock(new factory.BlockInfo(block.header))
                );

                const expectedHash = arrExpectedHashes.pop();
                const setResult = node._getBlocksFromLastKnown(arrExpectedHashes);

                assert.isOk(setResult);
                assert.equal(setResult.size, 1);
                assert.isOk(setResult.has(expectedHash));
            });

            it('should return EMPTY set for last known from CHAIN', async () => {

                const arrExpectedHashes = await createSimpleChain(
                    block => node._mainDag.addBlock(new factory.BlockInfo(block.header))
                );

                const expectedHash = arrExpectedHashes.pop();
                const setResult = node._getBlocksFromLastKnown([expectedHash]);

                assert.isOk(setResult);
                assert.equal(setResult.size, 0);
            });

            it('should return EMPTY set (FORK without root == all known)', async () => {
                const arrExpectedHashes = await createSimpleFork(
                    block => node._mainDag.addBlock(new factory.BlockInfo(block.header))
                );

                arrExpectedHashes.shift();

                const setResult = node._getBlocksFromLastKnown(arrExpectedHashes);
                assert.isOk(setResult);
                assert.equal(setResult.size, 0);
            });

            it('should return set of 3 elements without root (FORK)', async () => {
                const arrExpectedHashes = await createSimpleFork(
                    block => node._mainDag.addBlock(new factory.BlockInfo(block.header))
                );

                const genesis = arrExpectedHashes.shift();

                const setResult = node._getBlocksFromLastKnown([genesis]);
                assert.isOk(setResult);
                assert.equal(setResult.size, 3);
            });

            it('should return set of 1 elements: only child (FORK)', async () => {
                const arrExpectedHashes = await createSimpleFork(
                    block => node._mainDag.addBlock(new factory.BlockInfo(block.header))
                );

                arrExpectedHashes.shift();
                const block1 = arrExpectedHashes.shift();

                const setResult = node._getBlocksFromLastKnown([block1]);
                assert.isOk(setResult);
                assert.equal(setResult.size, 1);
            });
        });
    });
});

