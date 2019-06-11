const {describe, it} = require('mocha');
const {assert} = require('chai');
const debugLib = require('debug');
const sinon = require('sinon').createSandbox();

const factory = require('../testFactory');
const {generateAddress, processBlock} = require('../testUtil');
const {arrayEquals, prepareForStringifyObject} = require('../../utils');

process.on('warning', e => console.warn(e.stack));

// set to undefined to use random delays
const delay = undefined;
//const delay = 10;

let seedAddress;

let genesisNode;
let genesis;
let strConciliumDefContractTx;
let arrWitnesses;
let moneyIssueTx;

let witnessConciliumOne;
let witnessConciliumTwo;
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

        ({genesis, strConciliumDefContractTx, arrWitnesses, moneyIssueTx} = createGenesisBlock());
        genesisNode = new factory.Node({
            listenAddr: seedAddress,
            delay
        });
        await genesisNode.ensureLoaded();

        assert.isOk(genesis);
        assert.isOk(strConciliumDefContractTx);
        assert.isOk(moneyIssueTx);
        assert.isOk(Array.isArray(arrWitnesses) && arrWitnesses.length === 2);

        factory.Constants.GENESIS_BLOCK = genesis.getHash();
        const patch = await processBlock(genesisNode, genesis);

        if (patch) {
            receipt = patch.getReceipt(strConciliumDefContractTx);
            factory.Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS = receipt.getContractAddress().toString('hex');
        } else {
            throw new Error('Something went wrong! No patch to Genesis');
        }

        assert.isOk(factory.Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS);
        assert.isOk(factory.Constants.GENESIS_BLOCK);

        stepDone = true;
    });

    it('should create initial witness and receive genesis (bootstrap via DNS_SEED)', async function() {
        this.timeout(60000);

        const wallet = new factory.Wallet(arrWitnesses[0].privateKey);
        witnessConciliumOne = new factory.Witness({
            wallet,
            delay
        });

        await witnessConciliumOne.ensureLoaded();
        await witnessConciliumOne.bootstrap();

        // wait to receive Genesis block
        await (new Promise((resolve, reject) => {
            sinon.stub(witnessConciliumOne, '_postAcceptBlock').callsFake((block) => {
                if (block.getHash() === factory.Constants.GENESIS_BLOCK) {
                    resolve();
                } else {
                    reject();
                }
            });
        }));

        // we have definition for initial witness
        assert.isOk(await witnessConciliumOne._storage.getConciliumById(0));
        await witnessConciliumOne.start();

        stepDone = true;
    });

    it('should create & start another witness concilium', async function() {
        this.timeout(300000);

        const wallet = new factory.Wallet(arrWitnesses[1].privateKey);
        witnessConciliumTwo = new factory.Witness({
            wallet,
            arrSeedAddresses: [seedAddress],
            delay
        });
        await witnessConciliumTwo.ensureLoaded();
        await witnessConciliumTwo.bootstrap();

        // wait to receive Genesis block
        await (new Promise((resolve, reject) => {
            sinon.stub(witnessConciliumTwo, '_postAcceptBlock').callsFake((block) => {
                if (block.getHash() === factory.Constants.GENESIS_BLOCK) {
                    resolve();
                } else {
                    reject();
                }
            });
        }));
        sinon.restore();

        const txCode = createAnotherConcilium(wallet.privateKey, wallet.publicKey, moneyIssueTx.hash(), 4);
        await witnessConciliumTwo.rpcHandler({event: 'tx', content: txCode});

        // wait for witnessOne receive tx & produce block with new concilium def & send us (witnessConciliumTwo) second block
        const donePromise = new Promise((resolve, reject) => {
            sinon.stub(witnessConciliumTwo, '_postAcceptBlock').callsFake((block) => {
                if (block.txns.length === 2) {
                    resolve();
                } else {
                    reject();
                }
            });
        });

        await donePromise;

        assert.isOk(await witnessConciliumOne._storage.getConciliumById(1));
        assert.isOk(await witnessConciliumTwo._storage.getConciliumById(1));
        await witnessConciliumTwo.start();

        stepDone = true;
    });

    it('should be 0 pending & 2 stable blocks', async () => {
        assert.equal(witnessConciliumOne._pendingBlocks.getAllHashes().length, 0);
        assert.equal(witnessConciliumTwo._pendingBlocks.getAllHashes().length, 0);

        // all blocks
        assert.equal(witnessConciliumOne._mainDag.order, 2);
        assert.equal(witnessConciliumTwo._mainDag.order, 2);

        stepDone = true;
    });

    it('should produce block for second concilium', async function() {
        this.timeout(300000);

        const wallet = new factory.Wallet(arrWitnesses[1].privateKey);

        // create TX for new concilium (id: 1)
        const tx = new factory.Transaction();
        tx.conciliumId = 1;
        tx.addInput(moneyIssueTx.hash(), 5);
        tx.addReceiver(1e5, Buffer.from(wallet.address, 'hex'));
        tx.claim(0, wallet.privateKey);

        await witnessConciliumTwo.rpcHandler({event: 'tx', content: tx});

        {
            // wait for witnessConciliumTwo PRODUCE block concilium ==1
            const donePromise = new Promise((resolve, reject) => {
                sinon.stub(witnessConciliumTwo, '_postAcceptBlock').callsFake((block) => {
                    if (block.txns.length === 2 && block.conciliumId === 1) {
                        resolve();
                    } else {
                        reject();
                    }
                });
            });

            await donePromise;
        }

        {
            // wait for witnessConciliumOne RECEIVE this block for concilium == 1
            const donePromise = new Promise((resolve, reject) => {
                sinon.stub(witnessConciliumOne, '_postAcceptBlock').callsFake((block) => {
                    if (block.txns.length === 2 && block.conciliumId === 1) {
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
        assert.equal(witnessConciliumOne._pendingBlocks.getAllHashes().length, 1);
        assert.equal(witnessConciliumOne._mainDag.order, 3);
        assert.equal(witnessConciliumTwo._pendingBlocks.getAllHashes().length, 1);
        assert.equal(witnessConciliumTwo._mainDag.order, 3);

        stepDone = true;
    });

    it('should be same LAST_APPLIED_BLOCKS for both witnesses', async () => {
        const arrHashesOne = await witnessConciliumOne._storage.getLastAppliedBlockHashes();
        const arrHashesTwo = await witnessConciliumTwo._storage.getLastAppliedBlockHashes();

        assert.isOk(arrayEquals(arrHashesOne, arrHashesTwo));
        assert.equal(arrHashesOne.length, 1);

        stepDone = true;
    });

    it('should create one more block for each concilium', async function() {
        this.timeout(300000);

        const wallet = new factory.Wallet(arrWitnesses[0].privateKey);

        {
            // create TX for concilium (id: 0)
            const tx = new factory.Transaction();
            tx.conciliumId = 0;
            tx.addInput(moneyIssueTx.hash(), 1);
            tx.addReceiver(1e5, Buffer.from(wallet.address, 'hex'));
            tx.claim(0, wallet.privateKey);

            await witnessConciliumOne.rpcHandler({event: 'tx', content: tx});
        }

        {
            // wait for witnessConciliumOne RECEIVE this block for concilium == 0
            const donePromiseW1 = new Promise((resolve) => {
                sinon.stub(witnessConciliumOne, '_postAcceptBlock').callsFake((block) => {
                    if (block.txns.length === 2 && block.conciliumId === 0) {
                        resolve();
                    }
                });
            });

            // wait for witnessConciliumTwo receive that block
            const donePromiseW2 = new Promise((resolve) => {
                sinon.stub(witnessConciliumTwo, '_postAcceptBlock').callsFake((block) => {
                    if (block.txns.length === 2 && block.conciliumId === 0) {
                        resolve();
                    }
                });
            });

            await Promise.all([donePromiseW1, donePromiseW2]);
            sinon.restore();
        }

        {
            // create TX for concilium (id: 1)
            const tx = new factory.Transaction();
            tx.conciliumId = 1;
            tx.addInput(moneyIssueTx.hash(), 2);
            tx.addReceiver(1e5, Buffer.from(wallet.address, 'hex'));
            tx.claim(0, wallet.privateKey);

            await witnessConciliumTwo.rpcHandler({event: 'tx', content: tx});
        }

        {
            // wait for witnessConciliumTwo PRODUCE block concilium ==1
            const donePromiseW2 = new Promise((resolve) => {
                sinon.stub(witnessConciliumTwo, '_postAcceptBlock').callsFake((block) => {
                    if (block.txns.length === 2 && block.conciliumId === 1) {
                        resolve();
                    }
                });
            });

            // wait for witnessConciliumOne receive that block
            const donePromiseW1 = new Promise((resolve) => {
                sinon.stub(witnessConciliumOne, '_postAcceptBlock').callsFake((block) => {
                    if (block.txns.length === 2 && block.conciliumId === 1) {
                        resolve();
                    }
                });
            });

            await Promise.all([donePromiseW1, donePromiseW2]);
        }

        stepDone = true;
    });

    it('should be same LAST_APPLIED_BLOCKS for both witnesses (2 hashes)', async () => {
        const arrHashesOne = await witnessConciliumOne._storage.getLastAppliedBlockHashes();
        const arrHashesTwo = await witnessConciliumTwo._storage.getLastAppliedBlockHashes();

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

        // wait 4 blocks: Genesis, with definition of 2nd concilium, of new concilium, and one more
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

    const initialConcilium = factory.ConciliumRr.create(0, [witnessOne.publicKey], 1);

    const contractCode = `
class Concilium extends Base{
    constructor(objInitialDefinition) {
        super();
        this._arrConciliums=[];
        this._arrConciliums.push({
            ...objInitialDefinition,
            conciliumCreationTx: contractTx,
        });
    }

    changeDefinition(objNewDefinition){
    }
    
    addDefinition(objConcilium){
    
        // check fee!
        this._validateDefinition(objConcilium);
        this._arrConciliums.push({
            ...objConcilium,
            conciliumId: this._arrConciliums.length, 
            conciliumCreationTx: contractTx,
        });
    }
    
    _validateDefinition(objConcilium){
        if(!objConcilium.publicKeys) throw ('Bad definition');
    }
}

exports=new Concilium(${JSON.stringify(prepareForStringifyObject(initialConcilium.toObject()))});
`;

    const genesis = new factory.Block(0);

    // conciliumId=0 is default

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
    genesis.setHeight(1);
    genesis.finish(factory.Constants.fees.TX_FEE, generateAddress());

    console.log(`Genesis hash: ${genesis.getHash()}`);
    return {
        genesis,
        strConciliumDefContractTx: contractDeployTx.hash(),
        arrWitnesses: [witnessOne, witnessTwo],
        moneyIssueTx
    };
}

function createAnotherConcilium(strClaimPrivateKey, witnessPubKey, utxo, idx) {
    console.log(`Using UTXo ${utxo} idx ${idx}`);

    const concilium = factory.ConciliumRr.create(1, [witnessPubKey]);

    const contractCode = {
        method: 'addDefinition',
        arrArguments: [
            concilium.toObject()
        ]
    };

    // WARNING! it's just test/demo. All coins at this UTXO become fee
    const tx = factory.Transaction.invokeContract(
        factory.Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS,
        contractCode,
        0
    );

    // spend witness2 coins (WHOLE!)
    tx.addInput(utxo, idx);
    tx.claim(0, strClaimPrivateKey);

    return tx;
}
