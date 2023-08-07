const {describe, it} = require('mocha');
const {assert} = require('chai');
const os = require('os');
const debugLib = require('debug');
const sinon = require('sinon');
const Mutex = require('mutex');

const config = require('../../config/test.conf');
const TestFactory = require('../testFactory');
const {generateAddress, createDummyTx, processBlock, pseudoRandomBuffer} = require('../testUtil');
const {sleep, arrayIntersection} = require('../../utils');

const factory = new TestFactory(
    {
        testStorage: true,
        mutex: new Mutex(),
        workerSuspended: true,
        bDev: true
    },
    config.constants
);

process.on('warning', e => console.warn(e.stack));

// set to undefined to use random delays
//const delay = undefined;
const delay = 10;
//const maxConnections = 2;
const maxConnections = 4;
//const maxConnections = os.platform() === 'win32' ? 4 : 8;

let conciliumId = 11;
let arrKeyPairs;
let concilium;

const patchNodeForWitnesses = (node, concilium) => {
    node._storage.getConciliumsByAddress = sinon.fake.returns([concilium]);
    node._storage.getConciliumById = sinon.fake.returns(concilium);
};

const createDummyDefinition = (conciliumId = 0, numOfKeys = 2) => {
    const arrKeyPairs = [];
    const arrAddresses = [];
    for (let i = 0; i < numOfKeys; i++) {
        const keyPair = factory.Crypto.createKeyPair();
        arrKeyPairs.push(keyPair);
        arrAddresses.push(keyPair.address);
    }
    const concilium = factory.ConciliumRr.create(conciliumId, arrAddresses);

    return {arrKeyPairs, concilium};
};

let witnesNo = 1;
const createWitnesses = (num, seedAddress) => {
    const arrWitnesses = [];

    for (let i = 0; i < num; i++) {

        // we use arrKeyPairs that filled in beforeEach -> createDummyDefinition
        const witnessWallet = new factory.Wallet(arrKeyPairs[i].getPrivate());
        const witness = new factory.Witness({
            wallet: witnessWallet,
            listenAddr: factory.Transport.generateAddress(),
            delay,
            arrSeedAddresses: [seedAddress]
        });
        patchNodeForWitnesses(witness, concilium);
        arrWitnesses.push(witness);
    }
    witnesNo += num;

    return arrWitnesses;
};

const createGenesisBlock = () => {
    const tx = new factory.Transaction(createDummyTx());
    const block = new factory.Block(0);
    block.addTx(tx);
    block.finish(0, generateAddress());
    factory.Constants.GENESIS_BLOCK = block.hash();

    return block;
};

const createGenesisBlockAndSpendingTx = (conciliumId = 0) => {
    const receiverKeyPair = factory.Crypto.createKeyPair();
    const buffReceiverAddress = Buffer.from(receiverKeyPair.address, 'hex');

    // create "genesis" tx
    const txGen = new factory.Transaction();
    txGen.conciliumId = 0;
    txGen.addInput(Buffer.alloc(32), 0);
    txGen.addReceiver(1000000, buffReceiverAddress);

    // create "genesis" block
    const genesis = new factory.Block(0);
    genesis.addTx(txGen);
    genesis.setHeight(1);
    genesis.finish(0, generateAddress());
    factory.Constants.GENESIS_BLOCK = genesis.getHash();

    // create spending tx
    const tx = new factory.Transaction();
    tx.conciliumId = conciliumId;
    tx.addInput(txGen.hash(), 0);
    tx.addReceiver(1000, buffReceiverAddress);
    tx.claim(0, receiverKeyPair.privateKey);

    return {genesis, tx};
};

describe('Witness integration tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    beforeEach(async function() {
        ({arrKeyPairs, concilium} = createDummyDefinition(conciliumId, maxConnections));
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should ACT same as regular node (get peers from seedNode)', async function() {
        this.timeout(maxConnections * 60000);

        const genesis = createGenesisBlock();

        const seedAddress = factory.Transport.generateAddress();
        const seedNode = new factory.Node({listenAddr: seedAddress, delay, isSeed: true});
        await seedNode.ensureLoaded();

        await processBlock(seedNode, genesis);

        // Peers already known by seedNode
        const peerInfo1 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null}
            ],
            address: factory.Transport.strToAddress(factory.Transport.generateAddress())
        });
        const peerInfo2 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.WITNESS, data: Buffer.from('2222')}
            ],
            address: factory.Transport.strToAddress(factory.Transport.generateAddress())
        });
        for (let peerInfo of [peerInfo1, peerInfo2]) {
            await seedNode._peerManager.addPeer(peerInfo);
        }

        // create 'maxConnections' witnesses
        const arrWitnesses = createWitnesses(maxConnections, seedAddress);

        await Promise.all(arrWitnesses.map(witness => witness.ensureLoaded()));
        await Promise.all(arrWitnesses.map(witness => witness.bootstrap()));

        // there should be maxConnections  peers added to seed
        const arrPeers = seedNode._peerManager.filterPeers();
        assert.equal(arrPeers.length, maxConnections + 2);

        await Promise.all(arrWitnesses.map(witness => witness.start()));
    });

    it('should NOT commit block (empty mempool)', async function() {
        this.timeout(maxConnections * 60000);
        factory.Constants.WITNESS_HOLDOFF = 2 * maxConnections * 60000;

        const genesis = createGenesisBlock();

        const seedAddress = factory.Transport.generateAddress();
        const seedNode = new factory.Node({listenAddr: seedAddress, delay, isSeed: true});
        await seedNode.ensureLoaded();
        await processBlock(seedNode, genesis);

        // create 'maxConnections' witnesses
        const arrWitnesses = createWitnesses(maxConnections, seedAddress);

        const createBlockFake = sinon.fake();

        const arrSuppressedBlocksPromises = [];
        for (let i = 0; i < arrWitnesses.length; i++) {
            await arrWitnesses[i].ensureLoaded();
            await processBlock(arrWitnesses[i], genesis);
            arrSuppressedBlocksPromises.push(new Promise(resolve => {
                arrWitnesses[i]._suppressedBlockHandler = resolve;
                arrWitnesses[i]._acceptBlock = createBlockFake;
            }));
        }
        await Promise.all(arrWitnesses.map(witness => witness.bootstrap()));
        const arrStartPromises = [];
        for (let i = 0; i < arrWitnesses.length; i++) {
            await sleep(2000);
            arrStartPromises.push(arrWitnesses[i].start());
        }
        await Promise.all(arrStartPromises);

        // only one witness, BC round would advance only on successful block @see this._nextRound();
        await Promise.race(arrSuppressedBlocksPromises);

        assert.equal(createBlockFake.callCount, 0);
    });

    it('should commit one block (tx in mempool)', async function() {
        this.timeout(maxConnections * 60000);

        const {genesis, tx} = createGenesisBlockAndSpendingTx(conciliumId);

        const seedAddress = factory.Transport.generateAddress();
        const seedNode = new factory.Node({
            listenAddr: seedAddress,
            delay,
            arrTestDefinition: [concilium],
            isSeed: true
        });

        patchNodeForWitnesses(seedNode, concilium);
        await seedNode.ensureLoaded();
        await processBlock(seedNode, genesis);

        // create 'maxConnections' witnesses
        const arrWitnesses = createWitnesses(maxConnections, seedAddress);

        // prepare Done handlers for all witnesses & seedNode
        const arrBlocksPromises = [];
        for (let i = 0; i < arrWitnesses.length; i++) {
            await arrWitnesses[i].ensureLoaded();
            await processBlock(arrWitnesses[i], genesis);

            arrBlocksPromises.push(new Promise(resolve => {
                arrWitnesses[i]._postAcceptBlock = resolve;
            }));
            arrWitnesses[i]._canExecuteBlock = sinon.fake.returns(true);
        }

        // add seed to array also
        arrBlocksPromises.push(new Promise(resolve => {
            seedNode._postAcceptBlock = resolve;
        }));
        seedNode._canExecuteBlock = sinon.fake.returns(true);

        // run
        await Promise.all(arrWitnesses.map(witness => witness.bootstrap()));
        const arrStartPromises = [];
        for (let i = 0; i < arrWitnesses.length; i++) {
            await sleep(1000);
            arrStartPromises.push(arrWitnesses[i].start());
        }
        await Promise.all(arrStartPromises);

        // inject TX into network
        await seedNode.rpcHandler({event: 'tx', content: tx});

        // all witnesses + seedNode should get block (_acceptBlock called)
        await Promise.all(arrBlocksPromises);
    });

    it('should work for SINGLE WITNESS (commit one block tx in mempool)', async function() {
        this.timeout(maxConnections * 60000);

        ({arrKeyPairs, concilium} = createDummyDefinition(conciliumId, 1));
        const {genesis, tx} = createGenesisBlockAndSpendingTx(conciliumId);

        const seedAddress = factory.Transport.generateAddress();
        const seedNode = new factory.Node({
            listenAddr: seedAddress,
            delay,
            rpcUser: 'test',
            rpcPass: 'test',
            isSeed: true
        });
        patchNodeForWitnesses(seedNode, concilium);
        await seedNode.ensureLoaded();
        await processBlock(seedNode, genesis);

        // create ONE witnesses
        const [witness] = createWitnesses(1, seedAddress);
        await witness.ensureLoaded();
        await processBlock(witness, genesis);

        const arrBlocksPromises = [];
        arrBlocksPromises.push(new Promise(resolve => {
            witness._postAcceptBlock = resolve;
        }));
        witness._canExecuteBlock = sinon.fake.returns(true);

        // add seed to array also
        arrBlocksPromises.push(new Promise(resolve => {
            seedNode._postAcceptBlock = resolve;
        }));
        seedNode._canExecuteBlock = sinon.fake.returns(true);

        // run
        await witness.bootstrap();
        await witness.start();

        // inject TX into network
        await seedNode.rpcHandler({event: 'tx', content: tx});

        // all witnesses + seedNode should get block (_acceptBlock called)
        await Promise.all(arrBlocksPromises);
    });

    it('should NOT commit block (there is TX in mempool, but wrong conciliumId)', async function() {
        this.timeout(maxConnections * 60000);

        // this will prevent generating empty block while we run this test
        factory.Constants.WITNESS_HOLDOFF = 2 * maxConnections * 60000;

        // it will create tx for conciliumId==2
        const {genesis, tx} = createGenesisBlockAndSpendingTx(2);

        const seedAddress = factory.Transport.generateAddress();
        const seedNode = new factory.Node({
            listenAddr: seedAddress,
            delay: 10,
            rpcUser: 'test',
            rpcPass: 'test',
            isSeed: true
        });
//        patchNodeForWitnesses(seedNode, concilium);
        await seedNode.ensureLoaded();
        await processBlock(seedNode, genesis);

        // create 'maxConnections' witnesses for conciliumId (11 see global variable)
        const arrWitnesses = createWitnesses(maxConnections, seedAddress);

        const acceptBlockFake = sinon.fake();

        const arrSuppressedBlocksPromises = [];
        for (let i = 0; i < arrWitnesses.length; i++) {
            await arrWitnesses[i].ensureLoaded();
            await processBlock(arrWitnesses[i], genesis);
            arrSuppressedBlocksPromises.push(new Promise(resolve => {
                arrWitnesses[i]._suppressedBlockHandler = resolve;
                arrWitnesses[i]._acceptBlock = acceptBlockFake;
            }));
        }
        await Promise.all(arrWitnesses.map(witness => witness.bootstrap()));
        const arrStartPromises = [];
        for (let i = 0; i < arrWitnesses.length; i++) {
            await sleep(1000);
            arrStartPromises.push(arrWitnesses[i].start());
        }
        await Promise.all(arrStartPromises);

        await seedNode.rpcHandler({event: 'tx', content: tx});

        // only one witness, BC round would advance only on successful block @see this._nextRound();
        await Promise.race(arrSuppressedBlocksPromises);

        assert.equal(acceptBlockFake.callCount, 0);
    });

    describe('Join TX', async () => {
        let witness;
        let txHash;
        let txHash2;
        let coinbaseTxHash;

        beforeEach(async function() {
            this.timeout(60000);

            const amount = 1e6;
            const {arrKeyPairs, concilium} = createDummyDefinition();
            const kpReceiver = arrKeyPairs[0];
            const wallet = new factory.Wallet(kpReceiver.privateKey);

            witness = new factory.Witness({walletSupport: true, wallet});
            await witness.ensureLoaded();

            patchNodeForWitnesses(witness, concilium);
            await witness.start();

            factory.Constants.WITNESS_UTXOS_JOIN = 2;

            // "create" G
            let gBlock;
            {
                const tx = new factory.Transaction();
                tx.conciliumId = 0;

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
            await processBlock(witness, gBlock);

            // create child block2
            let block2;
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
                block2.setHeight(witness._calcHeight(block2.parentHashes));
                block2.finish(1e6 - 2e3, kpReceiver.getAddress());

                coinbaseTxHash = (new factory.Transaction(block2.txns[0])).getHash();
            }
            await processBlock(witness, block2);

            // create empty block3
            let block3;
            {
                block3 = new factory.Block(0);
                block3.parentHashes = [block2.getHash()];
                block3.setHeight(witness._calcHeight(block3.parentHashes));
                block3.finish(0, generateAddress());
            }
            await processBlock(witness, block3);
        });

        it('should create one block with join TX (immediate stabilization)', async function() {

            const {block: block4} = await witness._createBlock(0);

            assert.equal(block4.txns.length, 2);
            const txJoin = new factory.Transaction(block4.txns[1]);

            // it should contain 3 inputs
            assert.equal(txJoin.inputs.length, 3);
            const arrHashesInputs = txJoin.inputs.map(input => input.txHash.toString('hex'));
            assert.deepEqual(arrayIntersection([txHash, txHash2, coinbaseTxHash], arrHashesInputs), arrHashesInputs);
            await processBlock(witness, block4);

            // create next block
            const {block: block5} = await witness._createBlock(0);

            // it should contain only coinbase
            assert.equal(block5.txns.length, 1);
            await processBlock(witness, block5);

            // create next block
            const {block: block6} = await witness._createBlock(0);

            // it should contain only coinbase
            assert.equal(block6.txns.length, 1);
            await processBlock(witness, block6);
        });

        it('should create one block with join TX (non immediate stabilization)', async function() {
            witness._storage.getConciliumsCount = () => 3;

            const {block: block4} = await witness._createBlock(0);

            assert.equal(block4.txns.length, 2);
            const txJoin = new factory.Transaction(block4.txns[1]);

            // it should contain 3 inputs
            assert.equal(txJoin.inputs.length, 3);
            const arrHashesInputs = txJoin.inputs.map(input => input.txHash.toString('hex'));
            assert.deepEqual(arrayIntersection([txHash, txHash2, coinbaseTxHash], arrHashesInputs), arrHashesInputs);
            await processBlock(witness, block4);

            // create next block
            const {block: block5} = await witness._createBlock(0);

            // it should contain only coinbase (new joinTx will conflict with patch for block 4)
            assert.equal(block5.txns.length, 1);
            await processBlock(witness, block5);

            // create next block
            const {block: block6} = await witness._createBlock(0);

            // it should contain only coinbase (new joinTx will conflict with patch for block 4)
            assert.equal(block6.txns.length, 1);
            await processBlock(witness, block6);
        });
    });

});
