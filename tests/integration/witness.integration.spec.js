const {describe, it} = require('mocha');
const {assert} = require('chai');
const os = require('os');
const debugLib = require('debug');
const sinon = require('sinon');

const factory = require('../testFactory');
const {pseudoRandomBuffer, createDummyTx, processBlock} = require('../testUtil');
const {sleep} = require('../../utils');

process.on('warning', e => console.warn(e.stack));

// set to undefined to use random delays
const delay = undefined;
//const delay = 10;
//const maxConnections = 2;
const maxConnections = 4;
//const maxConnections = os.platform() === 'win32' ? 4 : 8;

let groupId = 11;
let arrKeyPairs;
let groupDefinition;

const patchNodeForWitnesses = (node, groupDefinition) => {
    node._storage.getWitnessGroupsByKey = sinon.fake.returns([groupDefinition]);
    node._storage.getWitnessGroupById = sinon.fake.returns(groupDefinition);
};

const createDummyDefinition = (groupId = 0, numOfKeys = 2) => {
    const arrKeyPairs = [];
    const arrPublicKeys = [];
    for (let i = 0; i < numOfKeys; i++) {
        const keyPair = factory.Crypto.createKeyPair();
        arrKeyPairs.push(keyPair);
        arrPublicKeys.push(keyPair.publicKey);
    }
    const groupDefinition = factory.WitnessGroupDefinition.create(groupId, arrPublicKeys);

    return {arrKeyPairs, groupDefinition};
};

let witnesNo = 1;
const createWitnesses = (num, seedAddress) => {
    const arrWitnesses = [];

    for (let i = 0; i < num; i++) {
        const witnessWallet = new factory.Wallet(arrKeyPairs[i].getPrivate());
        const witness = new factory.Witness({
            wallet: witnessWallet,
            listenAddr: factory.Transport.generateAddress(),
            delay,
            arrSeedAddresses: [seedAddress]
        });
        patchNodeForWitnesses(witness, groupDefinition);
        arrWitnesses.push(witness);
    }
    witnesNo += num;

    return arrWitnesses;
};

const createGenesisBlock = () => {
    const tx = new factory.Transaction(createDummyTx());
    const block = new factory.Block(0);
    block.addTx(tx);
    block.finish(0, pseudoRandomBuffer(33));
    factory.Constants.GENESIS_BLOCK = block.hash();

    return block;
};

const createGenesisBlockAndSpendingTx = (witnessGroupId = 0) => {
    const receiverKeyPair = factory.Crypto.createKeyPair();
    const buffReceiverAddress = factory.Crypto.getAddress(receiverKeyPair.publicKey, true);

    // create "genesis" tx
    const txGen = new factory.Transaction();
    txGen.witnessGroupId = 0;
    txGen.addInput(Buffer.alloc(32), 0);
    txGen.addReceiver(1000000, buffReceiverAddress);

    // create "genesis" block
    const genesis = new factory.Block(0);
    genesis.addTx(txGen);
    genesis.finish(0, pseudoRandomBuffer(33));
    factory.Constants.GENESIS_BLOCK = genesis.getHash();

    // create spending tx
    const tx = new factory.Transaction();
    tx.witnessGroupId = witnessGroupId;
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
        ({arrKeyPairs, groupDefinition} = createDummyDefinition(groupId, maxConnections));
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

        // all witnesses should call _suppressedBlockHandler
        await Promise.all(arrSuppressedBlocksPromises);

        assert.equal(createBlockFake.callCount, 0);
    });

    it('should commit one block (tx in mempool)', async function() {
        this.timeout(maxConnections * 60000);

        const {genesis, tx} = createGenesisBlockAndSpendingTx(groupId);

        const seedAddress = factory.Transport.generateAddress();
        const seedNode = new factory.Node({
            listenAddr: seedAddress,
            delay,
            arrTestDefinition: [groupDefinition],
            isSeed: true
        });

        patchNodeForWitnesses(seedNode, groupDefinition);
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

        ({arrKeyPairs, groupDefinition} = createDummyDefinition(groupId, 1));
        const {genesis, tx} = createGenesisBlockAndSpendingTx(groupId);

        const seedAddress = factory.Transport.generateAddress();
        const seedNode = new factory.Node({
            listenAddr: seedAddress,
            delay,
            rpcUser: 'test',
            rpcPass: 'test',
            isSeed: true
        });
        patchNodeForWitnesses(seedNode, groupDefinition);
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

    it('should NOT commit block (there is TX in mempool, but wrong witnessGroupId)', async function() {
        this.timeout(maxConnections * 60000);

        // this will prevent generating empty block while we run this test
        factory.Constants.WITNESS_HOLDOFF = 2 * maxConnections * 60000;

        // it will create tx for groupId==2
        const {genesis, tx} = createGenesisBlockAndSpendingTx(2);

        const seedAddress = factory.Transport.generateAddress();
        const seedNode = new factory.Node({
            listenAddr: seedAddress,
            delay: 10,
            rpcUser: 'test',
            rpcPass: 'test',
            isSeed: true
        });
//        patchNodeForWitnesses(seedNode, groupDefinition);
        await seedNode.ensureLoaded();
        await processBlock(seedNode, genesis);

        // create 'maxConnections' witnesses for groupId (11 see global variable)
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

        // all witnesses should call _suppressedBlockHandler
        await Promise.all(arrSuppressedBlocksPromises);

        assert.equal(acceptBlockFake.callCount, 0);
    });

    //    it('should DISCONNECT from FAKE Witness', async () => {

    //        const kpTest = factory.Crypto.createKeyPair();
    //        const kpGood = factory.Crypto.createKeyPair();
    //        const kpWalletFake = factory.Crypto.createKeyPair();
    //
    //        const groupName = 'test';
    //        const arrTestDefinition = [
    //            [groupName, [kpTest.getPublic(), kpGood.getPublic()]],
    //            ['anotherGroup', ['pubkey3', 'pubkey4']]
    //        ];
    //
    //        // create fake
    //        const fakeAddress=factory.Transport.strToAddress(`fake witness`);
    //        const fakeWitnessWallet = new factory.Wallet(kpWalletFake.getPrivate());
    //        const fakeWitness=new factory.Witness({
    //            wallet: fakeWitnessWallet, arrTestDefinition,
    //            listenAddr: fakeAddress, delay: 10,
    //            arrSeedAddresses: []
    //        });
    //
    //        // start our witness
    //        const wallet = new factory.Wallet(kpTest.getPrivate());
    //        const testWitness = new factory.Witness(
    //            {
    //                wallet, arrTestDefinition,
    //                listenAddr: factory.Transport.strToAddress('Test witness 2'),
    //                delay: 10, queryTimeout: 5000, arrSeedAddresses: [fakeAddress]
    //            });
    //        await testWitness.bootstrap();
    //        await testWitness.start();

    //    });
});
