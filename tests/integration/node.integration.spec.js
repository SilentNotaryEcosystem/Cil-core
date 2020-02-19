'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
const os = require('os');
const sinon = require('sinon');
const debugLib = require('debug');

const factory = require('../testFactory');
const factoryIpV6 = require('../testFactoryIpV6');
const {pseudoRandomBuffer, createDummyBlock, processBlock, generateAddress, createObjInvocationCode} = require(
    '../testUtil');
const {arrayIntersection} = require('../../utils');

chai.use(require('chai-as-promised'));
const {assert} = chai;

process.on('warning', e => console.warn(e.stack));

// set to undefined to use random delays
const delay = undefined;
//const delay = 10;
const maxConnections = os.platform() === 'win32' ? 4 : 8;
//const maxConnections=2;

const createGenesisPatchAndSpendingTx = (factory) => {
    const patch = new factory.PatchDB(0);

    const receiverKeyPair = factory.Crypto.createKeyPair();
    const buffAddress = factory.Crypto.getAddress(receiverKeyPair.publicKey, true);
    const utxoHash = pseudoRandomBuffer().toString('hex');

    // create "genesis"
    const coins = new factory.Coins(100000, buffAddress);
    patch.createCoins(utxoHash, 12, coins);
    patch.createCoins(utxoHash, 0, coins);
    patch.createCoins(utxoHash, 80, coins);

    // create tx

    const tx = new factory.Transaction();
    tx.addInput(utxoHash, 12);
    tx.addReceiver(1000, buffAddress);
    tx.claim(0, receiverKeyPair.privateKey);

    return {patch, tx};
};

const createNet = async (onlySeedProcessBlock = false) => {
    const genesis = createDummyBlock(factory);
    factory.Constants.GENESIS_BLOCK = genesis.getHash();

    const seedAddress = factory.Transport.generateAddress();
    const seedNode = new factory.Node({
        listenAddr: seedAddress,
        delay,
        rpcAddress: '::1',
        rpcUser: 'test',
        rpcPass: 'test',
        isSeed: true
    });
    await seedNode.ensureLoaded();
    await processBlock(seedNode, genesis);

    const arrNodes = [];
    for (let i = 0; i < maxConnections; i++) {
        const node = new factory.Node({arrSeedAddresses: [seedAddress], listenPort: 8000 + i});
        await node.ensureLoaded();

        if (!onlySeedProcessBlock) await processBlock(node, genesis);
        arrNodes.push(node);
    }
    return {seedNode, arrNodes};
};

const createLiveNet = async (onlySeedProcessBlock = false) => {
    const genesis = createDummyBlock(factoryIpV6);
    factoryIpV6.Constants.GENESIS_BLOCK = genesis.getHash();

    const seedNode = new factoryIpV6.Node({useNatTraversal: false, useNonRoutableAddresses: true});
    await seedNode.ensureLoaded();
    const seedAddress = seedNode._transport.myAddress;

    seedNode._rpc = new factoryIpV6.RPC(
        seedNode,
        {rpcAddress: seedAddress, rpcUser: 'test', rpcPass: 'test', useNatTraversal: false}
    );

    const arrNodes = [];
    for (let i = 0; i < maxConnections; i++) {
        const node = new factoryIpV6.Node({
            useNatTraversal: false,
            useNonRoutableAddresses: true,
            arrSeedAddresses: [seedAddress],
            listenPort: 8000 + i
        });
        await node.ensureLoaded();
        if (!onlySeedProcessBlock) await processBlock(node, genesis);
        arrNodes.push(node);
    }

    await processBlock(seedNode, genesis);

    return {seedNode, arrNodes};
};

describe('Node integration tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
        await factoryIpV6.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should disconnect from self', async function() {
        this.timeout(20000);

        const addr = factory.Transport.generateAddress();
        const newNode = new factory.Node({
            listenAddr: addr,
            delay,
            queryTimeout: 5000,
            arrSeedAddresses: [addr]
        });
        await newNode.ensureLoaded();
        await newNode.bootstrap();
    });

    it('should get peers from seedNode', async function() {
        this.timeout(20000);

        const seedAddress = factory.Transport.generateAddress();
        const seedNode = new factory.Node({listenAddr: seedAddress, delay, isSeed: true});
        seedNode._handleGetBlocksMessage = sinon.fake();
        await seedNode.ensureLoaded();

        const peerInfo1 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null},
                {service: factory.Constants.WITNESS, data: Buffer.from('asdasdasd')}
            ],
            address: factory.Transport.strToAddress(factory.Transport.generateAddress())
        });
        const peerInfo2 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null}
            ],
            address: factory.Transport.strToAddress(factory.Transport.generateAddress())
        });
        const peerInfo3 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.WITNESS, data: Buffer.from('1111')}
            ],
            address: factory.Transport.strToAddress(factory.Transport.generateAddress())
        });
        const peerInfo4 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.WITNESS, data: Buffer.from('2222')}
            ],
            address: factory.Transport.strToAddress(factory.Transport.generateAddress())
        });
        for (let peerInfo of [peerInfo1, peerInfo2, peerInfo3, peerInfo4]) {
            await seedNode._peerManager.addPeer(peerInfo);
        }

        const testNode = new factory.Node({
            listenAddr: factory.Transport.generateAddress(),
            delay, queryTimeout: 5000, arrSeedAddresses: [seedAddress],
            isSeed: true
        });

        await testNode.ensureLoaded();
        await testNode.bootstrap();

        const peers = testNode._peerManager.filterPeers();
        assert.isOk(peers && peers.length);

        // 4 from constructed object + seed
        assert.equal(peers.length, 5);
        assert.isOk(peers.every(peerInfo => peerInfo && peerInfo.capabilities && peerInfo.address && peerInfo.port));
    });

    it('should create nodes and get all of them connected and advertised to seed', async function() {
        this.timeout(60000);
        const {seedNode, arrNodes} = await createNet();
        const arrPromises = [];

        for (let i = 0; i < maxConnections; i++) {
            arrPromises.push(arrNodes[i].bootstrap());
        }
        await Promise.all(arrPromises);

        for (let node of arrNodes) {
            const peers = node._peerManager.filterPeers();
            assert.isOk(peers && peers.length);
        }

        const seedPeers = seedNode._peerManager.filterPeers();
        assert.isAtLeast(seedPeers.length, maxConnections);
        assert.isOk(seedPeers.every(peerInfo =>
            (peerInfo && peerInfo.capabilities && peerInfo.address && peerInfo.port) &&

            // we define custom ports 8000+i
            (peerInfo.port === factory.Constants.port ||
             (peerInfo.port >= 8000 && peerInfo.port <= 8000 + maxConnections))
        ));
    });

    it('should propagate TX over all nodes', async function() {
        this.timeout(60000);
        const {seedNode, arrNodes} = await createNet();
        const {patch, tx} = createGenesisPatchAndSpendingTx(factory);

        // make all nodes aware of utxo
        for (let node of arrNodes) node._storage.applyPatch(patch);
        seedNode._storage.applyPatch(patch);

        const arrBootrapPromises = [];
        const arrTxPromises = [];

        for (let i = 0; i < maxConnections; i++) {

            // set fakes for _mempool.addTx that means: node received tx
            arrTxPromises.push(new Promise(resolve => {
                arrNodes[i]._handleTxMessage = resolve;
            }));
            arrBootrapPromises.push(arrNodes[i].bootstrap());
        }
        await Promise.all(arrBootrapPromises);

        seedNode.rpc.sendRawTx({strTx: tx.encode().toString('hex')});

        await Promise.all(arrTxPromises);
    });

    it('should propagate GENESIS block over all nodes', async function() {
        this.timeout(60000);
        const {arrNodes} = await createNet(true);

        const arrBootstrapPromises = [];
        const arrBlockPromises = [];

        for (let i = 0; i < maxConnections; i++) {

            arrBlockPromises.push(new Promise(resolve => {
                arrNodes[i]._acceptBlock = resolve;
            }));
            arrBootstrapPromises.push(arrNodes[i].bootstrap());
        }
        await Promise.all(arrBootstrapPromises);
        await Promise.all(arrBlockPromises);
    });

    it('should create LIVE node & perform all async load', async () => {
        const node = new factoryIpV6.Node({useNatTraversal: false, listenPort: 1235});
        await node.ensureLoaded();

        assert.isOk(node);
        assert.isOk(node._myPeerInfo);
        assert.isOk(node._peerManager);
    });

    it('should prevent double spend in fork', async function() {
        this.timeout(60000);

        const amount = 1e6;
        const node = new factory.Node();
        await node.ensureLoaded();
        node._storage.getConciliumsCount = () => 1;
        node._unwindBlock = sinon.fake();

        const kpReceiver = factory.Crypto.createKeyPair();
        let txHash;

        // "create" G
        let gBlock;
        {
            const tx = new factory.Transaction();
            tx.conciliumId = 1;

            // spend idx 0
            tx.addInput(pseudoRandomBuffer(), 0);
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            gBlock = new factory.Block(0);
            gBlock.addTx(tx);
            gBlock.finish(0, generateAddress());

            gBlock.setHeight(0);

            txHash = tx.hash();

            factory.Constants.GENESIS_BLOCK = gBlock.getHash();
        }
        const gPatch = await processBlock(node, gBlock);
        assert.isOk(gPatch);

        // Genesis is stable now
        node._storage.getConciliumsCount = () => 3;

        {
            const utxo = gPatch.getUtxo(txHash);
            assert.isOk(utxo);
            const coins1 = utxo.coinsAtIndex(0);
            assert.isOk(coins1);
            assert.equal(coins1.getAmount(), amount);
            const coins2 = utxo.coinsAtIndex(1);
            assert.isOk(coins2);
            assert.equal(coins2.getAmount(), amount);
            assert.throws(() => utxo.coinsAtIndex(2));
        }

        // create block 2-1
        let block21;
        {
            const tx = new factory.Transaction();
            tx.conciliumId = 1;
            tx.addInput(txHash, 0);
            tx.addReceiver(1e3, generateAddress());
            tx.addReceiver(1e3, kpReceiver.getAddress(true));
            tx.claim(0, kpReceiver.privateKey);

            block21 = new factory.Block(1);
            block21.parentHashes = [gBlock.getHash()];
            block21.addTx(tx);
            block21.finish(1e6 - 2e3, generateAddress());

            block21.setHeight(node._calcHeight(block21.parentHashes));
        }
        const patch21 = await processBlock(node, block21);

        assert.isOk(patch21);
        {
            const utxo = patch21.getUtxo(txHash);
            assert.isOk(utxo);
            const coins2 = utxo.coinsAtIndex(1);
            assert.isOk(coins2);
            assert.equal(coins2.getAmount(), amount);

            assert.throws(() => utxo.coinsAtIndex(0));
        }

        // create block 1-0
        let block10;
        {
            const tx = new factory.Transaction();
            tx.conciliumId = 0;

            // spend idx 0
            tx.addInput(txHash, 0);
            tx.addReceiver(1e3, generateAddress());
            tx.addReceiver(1e3, kpReceiver.getAddress(true));
            tx.claim(0, kpReceiver.privateKey);

            block10 = new factory.Block(0);
            block10.parentHashes = [gBlock.getHash()];
            block10.addTx(tx);
            block10.finish(1e6 - 2e3, generateAddress());
            block10.setHeight(node._calcHeight(block10.parentHashes));
        }
        const patch10 = await processBlock(node, block10);

        // same for 2-1
        {
            const utxo = patch10.getUtxo(txHash);
            assert.isOk(utxo);
            const coins2 = utxo.coinsAtIndex(1);
            assert.isOk(coins2);
            assert.equal(coins2.getAmount(), amount);

            assert.throws(() => utxo.coinsAtIndex(0));
        }

        // create block 3-2
        let block32;
        {
            block32 = new factory.Block(2);
            block32.parentHashes = [block21.getHash()];
            block32.finish(0, generateAddress());
            block32.setHeight(node._calcHeight(block32.parentHashes));
        }
        const patch32 = await processBlock(node, block32);
        {

            // 2-1 become stable, utxo was flushed to storage
            let utxo = patch32.getUtxo(txHash);
            assert.isNotOk(utxo);

            // let's find it in storage
            const patchUtxo = await node._storage.getUtxosPatch([txHash]);
            assert.isOk(patchUtxo);

            utxo = patchUtxo.getUtxo(txHash);
            assert.isOk(utxo);
            const coins2 = utxo.coinsAtIndex(1);
            assert.isOk(coins2);
            assert.equal(coins2.getAmount(), amount);

            assert.throws(() => utxo.coinsAtIndex(0));

            // block 1-0 unwinded!
            assert.isOk(node._unwindBlock.calledOnce);
            const [block] = node._unwindBlock.args[0];
            assert.equal(block.getHash(), block10.getHash());
        }
    });

    it('should test one signature for multiple inputs', async function() {
        this.timeout(60000);

        const amount = 1e6;
        const node = new factory.Node();
        await node.ensureLoaded();
        node._storage.getConciliumsCount = () => 1;

        const kpReceiver = factory.Crypto.createKeyPair();
        let txHash;

        // "create" G
        let gBlock;
        {
            const tx = new factory.Transaction();
            tx.conciliumId = 1;

            // spend idx 0
            tx.addInput(pseudoRandomBuffer(), 0);
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            gBlock = new factory.Block(0);
            gBlock.addTx(tx);
            gBlock.finish(0, generateAddress());

            gBlock.setHeight(0);

            txHash = tx.hash();

            factory.Constants.GENESIS_BLOCK = gBlock.getHash();
        }
        const gPatch = await processBlock(node, gBlock);
        assert.isOk(gPatch);

        // create child block
        let block2;
        let txHash2;
        {
            const tx = new factory.Transaction();
            tx.conciliumId = 1;
            tx.addInput(txHash, 0);
            tx.addInput(txHash, 1);
            tx.addInput(txHash, 2);
            tx.addInput(txHash, 3);
            tx.addReceiver(2e6, generateAddress());
            tx.addReceiver(1e6, kpReceiver.getAddress(true));
            tx.signAllInputs(kpReceiver.privateKey);

            block2 = new factory.Block(1);
            block2.parentHashes = [gBlock.getHash()];
            block2.addTx(tx);
            block2.finish(4e6 - 3e6, generateAddress());

            block2.setHeight(node._calcHeight(block2.parentHashes));
            txHash2 = tx.getHash();
        }
        const patch21 = await processBlock(node, block2);

        assert.isOk(patch21);
        {

            // check the change
            const utxo = patch21.getUtxo(txHash2);
            assert.isOk(utxo);
            const coins = utxo.coinsAtIndex(1);
            assert.isOk(coins);
            assert.equal(coins.getAmount(), 1e6);
        }
    });

    it('should test one signature for multiple inputs (contract call)', async function() {
        this.timeout(60000);

        const amount = 1e6;
        const node = new factory.Node();
        await node.ensureLoaded();
        node._storage.getConciliumsCount = () => 1;

        const kpReceiver = factory.Crypto.createKeyPair();
        let txHash;
        let txContractHash;
        let strContractAddr;

        // "create" G
        let gBlock;
        {

            const contractCode = `
class TestClass extends Base{
    async testFunc() {
    }
}
exports=new TestClass();
`;
            const tx = new factory.Transaction();

            // spend idx 0
            tx.addInput(pseudoRandomBuffer(), 0);
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            tx.addReceiver(amount, kpReceiver.getAddress(true));

            const contractDeployTx = factory.Transaction.createContract(contractCode);

            gBlock = new factory.Block(0);
            gBlock.addTx(tx);
            gBlock.addTx(contractDeployTx);
            gBlock.finish(0, generateAddress());

            gBlock.setHeight(0);

            txHash = tx.hash();
            txContractHash = contractDeployTx.hash();

            factory.Constants.GENESIS_BLOCK = gBlock.getHash();
        }
        const gPatch = await processBlock(node, gBlock);
        assert.isOk(gPatch);

        const receipt = gPatch.getReceipt(txContractHash);
        strContractAddr = receipt.getContractAddress().toString('hex');

        // create child block
        let block2;
        let txHash2;
        {

            const tx = factory.Transaction.invokeContract(
                strContractAddr,
                createObjInvocationCode('testFunc', []),
                amount
            );

            tx.addInput(txHash, 0);
            tx.addInput(txHash, 1);
            tx.addInput(txHash, 2);
            tx.addInput(txHash, 3);

            tx.addReceiver(1e3, kpReceiver.getAddress(true));

            tx.signAllInputs(kpReceiver.privateKey);

            block2 = new factory.Block(1);
            block2.parentHashes = [gBlock.getHash()];
            block2.addTx(tx);

            // block fee was cheated, but this test not intended to verify it
            block2.finish(2987700, generateAddress());

            block2.setHeight(node._calcHeight(block2.parentHashes));
            txHash2 = tx.getHash();
        }
        const patch21 = await processBlock(node, block2);

        assert.isOk(patch21);
        {

            // check the change
            const utxo = patch21.getUtxo(txHash2);
            assert.isOk(utxo);
            const coins = utxo.coinsAtIndex(1);
            assert.isOk(coins);
            assert.equal(coins.getAmount(), 1e3);

            //
        }
    });

    it('should fail to exec same tx (blocks one by one)', async function() {
        this.timeout(60000);

        const amount = 1e6;
        const node = new factory.Node();
        await node.ensureLoaded();
        node._storage.getConciliumsCount = () => 1;
        node._unwindBlock = sinon.fake();

        const kpReceiver = factory.Crypto.createKeyPair();
        let txHash;

        // "create" G
        let gBlock;
        {
            const tx = new factory.Transaction();
            tx.conciliumId = 1;

            // spend idx 0
            tx.addInput(pseudoRandomBuffer(), 0);
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            gBlock = new factory.Block(0);
            gBlock.addTx(tx);
            gBlock.finish(0, generateAddress());

            gBlock.setHeight(0);

            txHash = tx.hash();

            factory.Constants.GENESIS_BLOCK = gBlock.getHash();
        }
        await processBlock(node, gBlock);

        // Genesis is stable now
        node._storage.getConciliumsCount = () => 4;

        // create Tx
        const tx = new factory.Transaction();
        tx.conciliumId = 0;
        tx.addInput(txHash, 0);
        tx.addReceiver(1e3, generateAddress());
        tx.addReceiver(1e3, kpReceiver.getAddress(true));
        tx.claim(0, kpReceiver.privateKey);

        // create child block2
        let block2;
        {
            block2 = new factory.Block(0);
            block2.parentHashes = [gBlock.getHash()];
            block2.addTx(tx);
            block2.finish(1e6 - 2e3, generateAddress());

            block2.setHeight(node._calcHeight(block2.parentHashes));
        }
        await processBlock(node, block2);

        // create child block3
        let block3;
        {
            block3 = new factory.Block(0);
            block3.parentHashes = [block2.getHash()];
            block3.addTx(tx);
            block3.finish(1e6 - 2e3, generateAddress());

            block3.setHeight(node._calcHeight(block3.parentHashes));
        }

        const strError = `Output #0 of Tx ${txHash} already spent!`;
        return assert.isRejected(processBlock(node, block3), new RegExp(strError));

    });

    it('should fail to exec same tx (blocks with interleave)', async function() {
        this.timeout(60000);

        const amount = 1e6;
        const node = new factory.Node();
        await node.ensureLoaded();
        node._storage.getConciliumsCount = () => 1;
        node._unwindBlock = sinon.fake();

        const kpReceiver = factory.Crypto.createKeyPair();
        let txHash;

        // "create" G
        let gBlock;
        {
            const tx = new factory.Transaction();
            tx.conciliumId = 1;

            // spend idx 0
            tx.addInput(pseudoRandomBuffer(), 0);
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            gBlock = new factory.Block(0);
            gBlock.addTx(tx);
            gBlock.finish(0, generateAddress());

            gBlock.setHeight(0);

            txHash = tx.hash();

            factory.Constants.GENESIS_BLOCK = gBlock.getHash();
        }
        await processBlock(node, gBlock);

        // Genesis is stable now
        node._storage.getConciliumsCount = () => 4;

        // create Tx
        const tx = new factory.Transaction();
        tx.conciliumId = 0;
        tx.addInput(txHash, 0);
        tx.addReceiver(1e3, generateAddress());
        tx.addReceiver(1e3, kpReceiver.getAddress(true));
        tx.claim(0, kpReceiver.privateKey);

        // create child block2
        let block2;
        {
            block2 = new factory.Block(0);
            block2.parentHashes = [gBlock.getHash()];
            block2.addTx(tx);
            block2.finish(1e6 - 2e3, generateAddress());

            block2.setHeight(node._calcHeight(block2.parentHashes));
        }
        await processBlock(node, block2);

        // create empty block3
        let block3;
        {
            block3 = new factory.Block(1);
            block3.parentHashes = [block2.getHash()];
            block3.finish(0, generateAddress());

            block3.setHeight(node._calcHeight(block3.parentHashes));
        }
        await processBlock(node, block3);

        // create child block4
        let block4;
        {
            block4 = new factory.Block(0);
            block4.parentHashes = [block3.getHash()];
            block4.addTx(tx);
            block4.finish(1e6 - 2e3, generateAddress());

            block4.setHeight(node._calcHeight(block4.parentHashes));
        }

        const strError = `Output #0 of Tx ${txHash} already spent!`;
        return assert.isRejected(processBlock(node, block4), new RegExp(strError));

    });

    it('should write wallet index (for new address)', async function() {
        this.timeout(60000);

        const amount = 1e6;
        const node = new factory.Node({walletSupport: true});
        await node.ensureLoaded();

        node._storage.getConciliumsCount = () => 1;
        node._unwindBlock = sinon.fake();

        const kpReceiver = factory.Crypto.createKeyPair();
        let txHash;

        // "create" G
        let gBlock;
        {
            const tx = new factory.Transaction();
            tx.conciliumId = 1;

            // spend idx 0
            tx.addInput(pseudoRandomBuffer(), 0);
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            gBlock = new factory.Block(0);
            gBlock.addTx(tx);
            gBlock.setHeight(0);
            gBlock.finish(0, generateAddress());

            txHash = tx.hash();

            factory.Constants.GENESIS_BLOCK = gBlock.getHash();
        }
        await processBlock(node, gBlock);

        node._storage.getConciliumsCount = () => 3;

        await node._storage.walletWatchAddress(kpReceiver.address);
        await node._storage.walletReIndex();

        // create child block2
        let block2;
        let txHash2;
        let coinbaseTxHash;
        {

            // create Tx
            const tx = new factory.Transaction();
            tx.conciliumId = 0;
            tx.addInput(txHash, 0);
            tx.addReceiver(1e3, generateAddress());
            tx.addReceiver(1e3, kpReceiver.getAddress(true));
            tx.claim(0, kpReceiver.privateKey);
            txHash2 = tx.getHash();

            block2 = new factory.Block(0);
            block2.parentHashes = [gBlock.getHash()];
            block2.addTx(tx);
            block2.setHeight(node._calcHeight(block2.parentHashes));
            block2.finish(1e6 - 2e3, kpReceiver.getAddress());

            coinbaseTxHash = (new factory.Transaction(block2.txns[0])).getHash();
        }
        await processBlock(node, block2);

        // create empty block3
        let block3;
        {
            block3 = new factory.Block(1);
            block3.parentHashes = [block2.getHash()];
            block3.setHeight(node._calcHeight(block3.parentHashes));
            block3.finish(0, generateAddress());
        }
        await processBlock(node, block3);

        const arrUtxos = await node._storage.walletListUnspent(kpReceiver.address);

        assert.equal(arrUtxos.length, 3);
        assert.equal(arrUtxos[0].getTxHash(), txHash);
        assert.equal(arrUtxos[1].getTxHash(), txHash2);
        assert.equal(arrUtxos[2].getTxHash(), coinbaseTxHash);
    });

    it('should rebuild wallet index (existed UTXOs)', async function() {
        this.timeout(60000);

        const amount = 1e6;
        const node = new factory.Node({walletSupport: true});
        await node.ensureLoaded();

        node._storage.getConciliumsCount = () => 1;
        node._unwindBlock = sinon.fake();

        const kpReceiver = factory.Crypto.createKeyPair();
        let txHash;

        // "create" G
        let gBlock;
        {
            const tx = new factory.Transaction();
            tx.conciliumId = 1;

            // spend idx 0
            tx.addInput(pseudoRandomBuffer(), 0);
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            tx.addReceiver(amount, kpReceiver.getAddress(true));
            gBlock = new factory.Block(0);
            gBlock.addTx(tx);
            gBlock.setHeight(0);
            gBlock.finish(0, generateAddress());

            txHash = tx.hash();

            factory.Constants.GENESIS_BLOCK = gBlock.getHash();
        }
        await processBlock(node, gBlock);

        node._storage.getConciliumsCount = () => 3;

        // create child block2
        let block2;
        let txHash2;
        let coinbaseTxHash;
        {

            // create Tx
            const tx = new factory.Transaction();
            tx.conciliumId = 0;
            tx.addInput(txHash, 0);
            tx.addReceiver(1e3, generateAddress());
            tx.addReceiver(1e3, kpReceiver.getAddress(true));
            tx.claim(0, kpReceiver.privateKey);
            txHash2 = tx.getHash();

            block2 = new factory.Block(0);
            block2.parentHashes = [gBlock.getHash()];
            block2.addTx(tx);
            block2.setHeight(node._calcHeight(block2.parentHashes));
            block2.finish(1e6 - 2e3, kpReceiver.getAddress());

            coinbaseTxHash = (new factory.Transaction(block2.txns[0])).getHash();
        }
        await processBlock(node, block2);

        // create empty block3
        let block3;
        {
            block3 = new factory.Block(1);
            block3.parentHashes = [block2.getHash()];
            block3.setHeight(node._calcHeight(block3.parentHashes));
            block3.finish(0, generateAddress());
        }
        await processBlock(node, block3);

        await node._storage.walletWatchAddress(kpReceiver.address);
        await node._storage.walletReIndex();

        const arrUtxos = await node._storage.walletListUnspent(kpReceiver.address);

        assert.equal(arrUtxos.length, 3);

        const arrHashesUtxo = arrUtxos.map(utxo => utxo.getTxHash());
        assert.deepEqual(arrayIntersection([txHash, txHash2, coinbaseTxHash], arrHashesUtxo), arrHashesUtxo);
    });
});
