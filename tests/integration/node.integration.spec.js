'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const os = require('os');
const debugLib = require('debug');
const util = require('util');

const factory = require('../testFactory');
const {createDummyTx, pseudoRandomBuffer} = require('../testUtil');

const debugNode = debugLib('node:app');

const maxConnections = os.platform() === 'win32' ? 4 : 10;

const createGenezisPatchAndSpendingTx = (factory) => {
    const patch = new factory.PatchDB();

    const receiverKeyPair = factory.Crypto.createKeyPair();
    const buffAddress = factory.Crypto.getAddress(receiverKeyPair.publicKey, true);
    const utxoHash = pseudoRandomBuffer().toString('hex');

    // create "genezis"
    const coins = new factory.Coins(100000, buffAddress);
    patch.createCoins(utxoHash, 12, coins);
    patch.createCoins(utxoHash, 0, coins);
    patch.createCoins(utxoHash, 80, coins);

    // create tx

    const tx = new factory.Transaction();
    tx.addInput(utxoHash, 12);
    tx.addReceiver(1000, buffAddress);
    tx.sign(0, receiverKeyPair.privateKey);

    return {patch, tx};
};

const createNet = () => {
    const seedAddress = factory.Transport.generateAddress();
    const seedNode = new factory.Node({listenAddr: seedAddress, delay: 0});

    const arrNodes = [];
    for (let i = 0; i < maxConnections; i++) {
        const node = new factory.Node({arrSeedAddresses: [seedAddress], listenPort: 8000 + i});
        arrNodes.push(node);
    }
    return {seedNode, arrNodes};
};

describe('Node integration tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should disconnect from self', async () => {
        const addr = factory.Transport.strToAddress('Loop node');
        const newNode = new factory.Node({
            listenAddr: addr,
            delay: 0, queryTimeout: 5000,
            arrSeedAddresses: [addr]
        });
        await newNode.bootstrap();
    });

    it('should get peers from seedNode', async function() {
        this.timeout(20000);

        const seedAddress = factory.Transport.strToAddress('Seed node');
        const seedNode = new factory.Node({listenAddr: seedAddress, delay: 0});
        const peerInfo1 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null},
                {service: factory.Constants.WITNESS, data: Buffer.from('asdasdasd')}
            ],
            address: factory.Transport.strToAddress('Known node 1')
        });
        const peerInfo2 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null}
            ],
            address: factory.Transport.strToAddress('Known node 2')
        });
        const peerInfo3 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.WITNESS, data: Buffer.from('1111')}
            ],
            address: factory.Transport.strToAddress('Known node 3')
        });
        const peerInfo4 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.WITNESS, data: Buffer.from('2222')}
            ],
            address: factory.Transport.strToAddress('Known node 4')
        });
        [peerInfo1, peerInfo2, peerInfo3, peerInfo4].forEach(peerInfo => seedNode._peerManager.addPeer(peerInfo));

        const testNode = new factory.Node({
            listenAddr: factory.Transport.strToAddress('Test node'),
            delay: 10, queryTimeout: 5000, arrSeedAddresses: [seedAddress]
        });
        await testNode.bootstrap();

        const peers = testNode._peerManager.filterPeers();
        assert.isOk(peers && peers.length);

        // 4 from constructed object + seed + self
        assert.equal(peers.length, 6);
        peers.forEach(peerInfo => {
            assert.isOk(peerInfo && peerInfo.capabilities && peerInfo.address && peerInfo.port);
        });
    });

    it('should create nodes and get all of them connected and advertised to seed', async function() {
        this.timeout(60000);
        const {seedNode, arrNodes} = createNet();
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
        seedPeers.forEach(peerInfo => {
            assert.isOk(peerInfo && peerInfo.capabilities && peerInfo.address && peerInfo.port);

            // we define custom ports 8000+i
            assert.isOk(peerInfo.port >= 8000 && peerInfo.port <= 8000 + maxConnections);
        });
    });

    it('should propagate TX over all nodes', async function() {
        this.timeout(60000);
        const {seedNode, arrNodes} = createNet();
        const {patch, tx} = createGenezisPatchAndSpendingTx(factory);

        // make all nodes aware of utxo
        for (let node of arrNodes) node._storage.applyPatch(patch);
        seedNode._storage.applyPatch(patch);

        const arrBootrapPromises = [];
        const arrTxPromises = [];

        for (let i = 0; i < maxConnections; i++) {

            // set fakes for _mempool.addTx that means: node received tx
            arrTxPromises.push(new Promise(resolve => {
                arrNodes[i]._mempool.addTx = resolve;
            }));
            arrBootrapPromises.push(arrNodes[i].bootstrap());
        }
        await Promise.all(arrBootrapPromises);

        seedNode.rpc.sendRawTx(tx.encode());

        await Promise.all(arrTxPromises);
    });

    it('should propagate GENEZIS block over all nodes', async function() {
        const tx = new factory.Transaction(createDummyTx());
        const block = new factory.Block(0);
        block.addTx(tx);
        block.finish(0, pseudoRandomBuffer(33));
        factory.Constants.GENEZIS_BLOCK = block.hash();

        this.timeout(60000);
        const {seedNode, arrNodes} = createNet();
        const arrBootrapPromises = [];
        const arrTxPromises = [];

        for (let i = 0; i < maxConnections; i++) {

            // set fakes for _storage.saveBlock that means: node processed block
            arrTxPromises.push(new Promise(resolve => {
                arrNodes[i]._acceptBlock = resolve;
            }));
            arrBootrapPromises.push(arrNodes[i].bootstrap());
        }
        await Promise.all(arrBootrapPromises);

        // inject block to seed node
        const patch = await seedNode._processBlock(block);
        await seedNode._acceptBlock(block, patch);

        await Promise.all(arrTxPromises);
    });
});
