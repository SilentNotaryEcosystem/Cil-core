const {describe, it} = require('mocha');
const {assert} = require('chai');
const debugLib = require('debug');
const sinon = require('sinon').createSandbox();

const factory = require('../testFactory');
const {pseudoRandomBuffer, processBlock} = require('../testUtil');
const {arrayEquals} = require('../../utils');

process.on('warning', e => console.warn(e.stack));

// set to undefined to use random delays
const delay = undefined;
//const delay = 10;

let seedAddress;

let genesisNode;
let genesis;
let strGroupDefContractTx;
let arrWitnesses;
let moneyIssueTx;

let witnessGroupOne;
let witnessGroupTwo;
let nodeThree;
let nodeFour;

let stepDone = false;

describe('Genesis net tests (it runs one by one!)', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();

        seedAddress = factory.Transport.generateAddress();
        factory.Constants.DNS_SEED = [seedAddress];
    });

    beforeEach(() => {
        stepDone = false;
    });

    afterEach(() => {
        assert.isOk(stepDone, 'Previous step failed!');
        sinon.restore();
    });

    it('should create genesis node & block', async function() {
        this.timeout(60000);

        ({genesis, strGroupDefContractTx, arrWitnesses, moneyIssueTx} = createGenesisBlock());
        genesisNode = new factory.Node({
            listenAddr: seedAddress,
            delay
        });
        await genesisNode.ensureLoaded();

        assert.isOk(genesis);
        assert.isOk(strGroupDefContractTx);
        assert.isOk(moneyIssueTx);
        assert.isOk(Array.isArray(arrWitnesses) && arrWitnesses.length === 2);

        factory.Constants.GENESIS_BLOCK = genesis.getHash();
        const patch = await processBlock(genesisNode, genesis);

        if (patch) {
            receipt = patch.getReceipt(strGroupDefContractTx);
            factory.Constants.GROUP_DEFINITION_CONTRACT_ADDRESS = receipt.getContractAddress().toString('hex');
        } else {
            throw new Error('Something went wrong! No patch to Genesis');
        }

        assert.isOk(factory.Constants.GROUP_DEFINITION_CONTRACT_ADDRESS);
        assert.isOk(factory.Constants.GENESIS_BLOCK);

        stepDone = true;
    });

    it('should create initial witness and receive genesis (bootstrap via DNS_SEED)', async function() {
        this.timeout(60000);

        const wallet = new factory.Wallet(arrWitnesses[0].privateKey);
        witnessGroupOne = new factory.Witness({
            wallet,
            delay
        });

        await witnessGroupOne.ensureLoaded();
        await witnessGroupOne.bootstrap();

        // wait to receive Genesis block
        await (new Promise((resolve, reject) => {
            sinon.stub(witnessGroupOne, '_postAcceptBlock').callsFake((block) => {
                if (block.getHash() === factory.Constants.GENESIS_BLOCK) {
                    resolve();
                } else {
                    reject();
                }
            });
        }));

        // we have definition for initial witness
        assert.isOk(await witnessGroupOne._storage.getWitnessGroupById(0));
        await witnessGroupOne.start();

        stepDone = true;
    });

    it('should create & start another witness group', async function() {
        this.timeout(300000);

        const wallet = new factory.Wallet(arrWitnesses[1].privateKey);
        witnessGroupTwo = new factory.Witness({
            wallet,
            arrSeedAddresses: [seedAddress],
            delay
        });
        await witnessGroupTwo.ensureLoaded();
        await witnessGroupTwo.bootstrap();

        // wait to receive Genesis block
        await (new Promise((resolve, reject) => {
            sinon.stub(witnessGroupTwo, '_postAcceptBlock').callsFake((block) => {
                if (block.getHash() === factory.Constants.GENESIS_BLOCK) {
                    resolve();
                } else {
                    reject();
                }
            });
        }));
        sinon.restore();

        const txCode = createAnotherGroup(wallet.privateKey, wallet.publicKey, moneyIssueTx.hash(), 4);
        await witnessGroupTwo.rpcHandler({event: 'tx', content: txCode});

        // wait for witnessOne receive tx & produce block with new group def & send us (witnessGroupTwo) second block
        const donePromise = new Promise((resolve, reject) => {
            sinon.stub(witnessGroupTwo, '_postAcceptBlock').callsFake((block) => {
                if (block.txns.length === 2) {
                    resolve();
                } else {
                    reject();
                }
            });
        });

        await donePromise;

        assert.isOk(await witnessGroupOne._storage.getWitnessGroupById(1));
        assert.isOk(await witnessGroupTwo._storage.getWitnessGroupById(1));
        await witnessGroupTwo.start();

        stepDone = true;
    });

    it('should be 0 pending & 2 stable blocks', async () => {
        assert.equal(witnessGroupOne._pendingBlocks.getAllHashes().length, 0);
        assert.equal(witnessGroupTwo._pendingBlocks.getAllHashes().length, 0);

        // all blocks
        assert.equal(witnessGroupOne._mainDag.order, 2);
        assert.equal(witnessGroupTwo._mainDag.order, 2);

        stepDone = true;
    });

    it('should produce block for second group', async function() {
        this.timeout(300000);

        const wallet = new factory.Wallet(arrWitnesses[1].privateKey);

        // create TX for new group (id: 1)
        const tx = new factory.Transaction();
        tx.witnessGroupId = 1;
        tx.addInput(moneyIssueTx.hash(), 5);
        tx.addReceiver(1e5, Buffer.from(wallet.address, 'hex'));
        tx.claim(0, wallet.privateKey);

        await witnessGroupTwo.rpcHandler({event: 'tx', content: tx});

        {
            // wait for witnessGroupTwo PRODUCE block group ==1
            const donePromise = new Promise((resolve, reject) => {
                sinon.stub(witnessGroupTwo, '_postAcceptBlock').callsFake((block) => {
                    if (block.txns.length === 2 && block.witnessGroupId === 1) {
                        resolve();
                    } else {
                        reject();
                    }
                });
            });

            await donePromise;
        }

        {
            // wait for witnessGroupOne RECEIVE this block for group == 1
            const donePromise = new Promise((resolve, reject) => {
                sinon.stub(witnessGroupOne, '_postAcceptBlock').callsFake((block) => {
                    if (block.txns.length === 2 && block.witnessGroupId === 1) {
                        resolve();
                    } else {
                        reject();
                    }
                });
            });

            await donePromise;
        }

        stepDone = true;
    });

    it('should be only one pending block', async () => {
        assert.equal(witnessGroupOne._pendingBlocks.getAllHashes().length, 1);
        assert.equal(witnessGroupOne._mainDag.order, 3);
        assert.equal(witnessGroupTwo._pendingBlocks.getAllHashes().length, 1);
        assert.equal(witnessGroupTwo._mainDag.order, 3);

        stepDone = true;
    });

    it('should be same LAST_APPLIED_BLOCKS for both witnesses', async () => {
        const arrHashesOne = await witnessGroupOne._storage.getLastAppliedBlockHashes();
        const arrHashesTwo = await witnessGroupTwo._storage.getLastAppliedBlockHashes();

        assert.isOk(arrayEquals(arrHashesOne, arrHashesTwo));
        assert.equal(arrHashesOne.length, 1);

        stepDone = true;
    });

    it('should create one more block for each group', async function() {
        this.timeout(300000);

        const wallet = new factory.Wallet(arrWitnesses[0].privateKey);

        {
            // create TX for group (id: 0)
            const tx = new factory.Transaction();
            tx.witnessGroupId = 0;
            tx.addInput(moneyIssueTx.hash(), 1);
            tx.addReceiver(1e5, Buffer.from(wallet.address, 'hex'));
            tx.claim(0, wallet.privateKey);

            await witnessGroupOne.rpcHandler({event: 'tx', content: tx});
        }

        {
            // wait for witnessGroupOne RECEIVE this block for group == 0
            const donePromiseW1 = new Promise((resolve) => {
                sinon.stub(witnessGroupOne, '_postAcceptBlock').callsFake((block) => {
                    if (block.txns.length === 2 && block.witnessGroupId === 0) {
                        resolve();
                    }
                });
            });

            // wait for witnessGroupTwo receive that block
            const donePromiseW2 = new Promise((resolve) => {
                sinon.stub(witnessGroupTwo, '_postAcceptBlock').callsFake((block) => {
                    if (block.txns.length === 2 && block.witnessGroupId === 0) {
                        resolve();
                    }
                });
            });

            await Promise.all([donePromiseW1, donePromiseW2]);
            sinon.restore();
        }

        {
            // create TX for group (id: 1)
            const tx = new factory.Transaction();
            tx.witnessGroupId = 1;
            tx.addInput(moneyIssueTx.hash(), 2);
            tx.addReceiver(1e5, Buffer.from(wallet.address, 'hex'));
            tx.claim(0, wallet.privateKey);

            await witnessGroupTwo.rpcHandler({event: 'tx', content: tx});
        }

        {
            // wait for witnessGroupTwo PRODUCE block group ==1
            const donePromiseW2 = new Promise((resolve) => {
                sinon.stub(witnessGroupTwo, '_postAcceptBlock').callsFake((block) => {
                    if (block.txns.length === 2 && block.witnessGroupId === 1) {
                        resolve();
                    }
                });
            });

            // wait for witnessGroupOne receive that block
            const donePromiseW1 = new Promise((resolve) => {
                sinon.stub(witnessGroupOne, '_postAcceptBlock').callsFake((block) => {
                    if (block.txns.length === 2 && block.witnessGroupId === 1) {
                        resolve();
                    }
                });
            });

            await Promise.all([donePromiseW1, donePromiseW2]);
        }

        stepDone = true;
    });

    it('should be same LAST_APPLIED_BLOCKS for both witnesses (2 hashes)', async () => {
        const arrHashesOne = await witnessGroupOne._storage.getLastAppliedBlockHashes();
        const arrHashesTwo = await witnessGroupTwo._storage.getLastAppliedBlockHashes();

        assert.isOk(arrayEquals(arrHashesOne, arrHashesTwo));
        assert.equal(arrHashesOne.length, 2);

        stepDone = true;
    });

    it('should create 3d node and load 4 blocks', async function() {
        this.timeout(300000);

        nodeThree = new factory.Node({
            arrSeedAddresses: [seedAddress],
            delay
        });
        await nodeThree.ensureLoaded();
        await nodeThree.bootstrap();

        // wait 4 blocks: Genesis, with definition of 2nd group, of new group, and one more
        const donePromise = new Promise((resolve) => {
            let i = 0;
            sinon.stub(nodeThree, '_postAcceptBlock').callsFake(() => {
                if (++i === 4) {resolve();}
            });
        });

        await donePromise;

        assert.equal(nodeThree._pendingBlocks.getAllHashes().length, 1);
        assert.equal(nodeThree._mainDag.order, 4);

        stepDone = true;
    });

    it('should create 4th node, that has Genesis, so it should load 3 blocks', async function() {
        this.timeout(300000);

        nodeFour = new factory.Node({
            arrSeedAddresses: [seedAddress],
            delay
        });
        await nodeFour.ensureLoaded();
        await processBlock(nodeFour, genesis);

        assert.equal(nodeFour._pendingBlocks.getAllHashes().length, 0);
        assert.equal(nodeFour._mainDag.order, 1);

        await nodeFour.bootstrap();

        // wait 3 blocks: all except Genesis
        const donePromise = new Promise((resolve) => {
            let i = 0;
            sinon.stub(nodeFour, '_postAcceptBlock').callsFake(() => {
                if (++i === 3) {resolve();}
            });
        });

        await donePromise;

        assert.equal(nodeFour._pendingBlocks.getAllHashes().length, 1);
        assert.equal(nodeFour._mainDag.order, 4);

        stepDone = true;
    });

});

function createGenesisBlock() {
    const witnessOne = factory.Crypto.createKeyPair();
    const witnessTwo = factory.Crypto.createKeyPair();

    const strCommaSeparatedKeys = [witnessOne]
        .map(w => `'${w.publicKey}'`)
        .join(',');

    const contractCode = `
class GroupDefinition extends Base{
    constructor(...arrKeys) {
        super();
        this._arrGroupDefinitions=[];
        this._arrGroupDefinitions.push({
            publicKeys: arrKeys,
            groupCreationTx: contractTx,
            groupId: 0,
            quorum: 1,
            delegatesPublicKeys: arrKeys
        });
    }

    changeDefinition(objNewDefinition){
    }
    
    addDefinition(objGroupDefinition){
    
        // check fee!
        this._validateDefinition(objGroupDefinition);
        this._arrGroupDefinitions.push({
            groupId: this._arrGroupDefinitions.length, 
            groupCreationTx: contractTx,

            quorum: objGroupDefinition.quorum,
            publicKeys: objGroupDefinition.publicKeys,
            delegatesPublicKeys: objGroupDefinition.delegatesPublicKeys
        });
    }
    
    _validateDefinition(objGroupDefinition){
        if(!objGroupDefinition.publicKeys 
            || !objGroupDefinition.quorum 
            || !objGroupDefinition.delegatesPublicKeys) throw ('Bad definition');
    }
}

exports=new GroupDefinition(${strCommaSeparatedKeys});
`;

    const genesis = new factory.Block(0);

    // witnessGroupId=0 is default

    const moneyIssueTx = new factory.Transaction();
    moneyIssueTx.addReceiver(1e8, witnessOne.getAddress());
    moneyIssueTx.addReceiver(1e8, witnessOne.getAddress());
    moneyIssueTx.addReceiver(1e8, witnessOne.getAddress());
    moneyIssueTx.addReceiver(1e8, witnessOne.getAddress());
    moneyIssueTx.addReceiver(1e8, witnessTwo.getAddress());
    moneyIssueTx.addReceiver(1e8, witnessTwo.getAddress());
    moneyIssueTx.addReceiver(1e8, witnessTwo.getAddress());
    moneyIssueTx.addReceiver(1e8, witnessTwo.getAddress());

    const contractDeployTx = factory.Transaction.createContract(contractCode);

    genesis.addTx(moneyIssueTx);
    genesis.addTx(contractDeployTx);
    genesis.finish(factory.Constants.fees.TX_FEE, pseudoRandomBuffer(33));

    console.log(`Genesis hash: ${genesis.getHash()}`);
    return {
        genesis,
        strGroupDefContractTx: contractDeployTx.hash(),
        arrWitnesses: [witnessOne, witnessTwo],
        moneyIssueTx
    };
}

function createAnotherGroup(strClaimPrivateKey, witnessPubKey, utxo, idx) {

    const contractCode = {
        method: 'addDefinition',
        arrArguments: [
            {
                quorum: 1,
                publicKeys: [witnessPubKey],
                delegatesPublicKeys: [witnessPubKey]
            }]
    };

    // WARNING! it's just test/demo. All coins at this UTXO become fee
    const tx = factory.Transaction.invokeContract(
        factory.Constants.GROUP_DEFINITION_CONTRACT_ADDRESS,
        contractCode,
        0
    );

    // spend witness2 coins (WHOLE!)
    tx.addInput(utxo, idx);
    tx.claim(0, strClaimPrivateKey);

    return tx;
}
