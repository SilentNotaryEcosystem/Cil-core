'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const os = require('os');
const sinon = require('sinon');
const debugLib = require('debug');
const util = require('util');

const factory = require('../testFactory');
const factoryIpV6 = require('../testFactoryIpV6');
const {createDummyTx, pseudoRandomBuffer, createDummyBlock} = require('../testUtil');

process.on('warning', e => console.warn(e.stack));

const debugNode = debugLib('node:app');

// set to undefined to use random delays
const delay = undefined;
//const delay = 10;
const maxConnections = os.platform() === 'win32' ? 4 : 10;

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
    tx.sign(0, receiverKeyPair.privateKey);

    return {patch, tx};
};

const createNet = async (onlySeed = false) => {
    const genesis = createDummyBlock(factory);
    factory.Constants.GENESIS_BLOCK = genesis.getHash();

    const seedAddress = factory.Transport.generateAddress();
    const seedNode = new factory.Node({listenAddr: seedAddress, delay, rpcUser: 'test', rpcPass: 'test'});
    await seedNode.ensureLoaded();

    await seedNode._processBlock(genesis);

    const arrNodes = [];
    for (let i = 0; i < maxConnections; i++) {
        const node = new factory.Node({arrSeedAddresses: [seedAddress], listenPort: 8000 + i});
        await node.ensureLoaded();
        if (!onlySeed) await node._processBlock(genesis);
        arrNodes.push(node);
    }
    return {seedNode, arrNodes};
};

const createLiveNet = async (onlySeed = false) => {
    const genesis = createDummyBlock(factoryIpV6);
    factoryIpV6.Constants.GENESIS_BLOCK = genesis.getHash();

    const [seedAddress] = factoryIpV6.Transport.getInterfacesIpV6Addresses();
    const seedNode = new factoryIpV6.Node({listenAddr: seedAddress, rpcUser: 'test', rpcPass: 'test'});
    await seedNode.ensureLoaded();
    await seedNode._processBlock(genesis);

    const arrNodes = [];
    for (let i = 0; i < maxConnections; i++) {
        const node = new factoryIpV6.Node({arrSeedAddresses: [seedAddress], listenPort: 8000 + i});
        await node.ensureLoaded();
        if (!onlySeed) await node._processBlock(genesis);
        arrNodes.push(node);
    }
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
        await newNode.bootstrap();
    });

    it('should get peers from seedNode', async function() {
        this.timeout(20000);

        const seedAddress = factory.Transport.generateAddress();
        const seedNode = new factory.Node({listenAddr: seedAddress, delay});
        seedNode._handleGetBlocksMessage = sinon.fake();

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
        for(let peerInfo of [peerInfo1, peerInfo2, peerInfo3, peerInfo4]) {
            await seedNode._peerManager.addPeer(peerInfo);
        }

        const testNode = new factory.Node({
            listenAddr: factory.Transport.generateAddress(),
            delay, queryTimeout: 5000, arrSeedAddresses: [seedAddress]
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
        seedPeers.forEach(peerInfo => {
            assert.isOk(peerInfo && peerInfo.capabilities && peerInfo.address && peerInfo.port);

            // we define custom ports 8000+i
            assert.isOk(peerInfo.port >= 8000 && peerInfo.port <= 8000 + maxConnections);
        });
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
                arrNodes[i]._mempool.addTx = resolve;
            }));
            arrBootrapPromises.push(arrNodes[i].bootstrap());
        }
        await Promise.all(arrBootrapPromises);

        seedNode.rpc.sendRawTx(tx.encode());

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

    it('should create LIVE NET and propagate GENESIS block over all nodes', async function() {
        this.timeout(60000);
        const {arrNodes} = await createLiveNet(true);

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
});
