const {describe, it} = require('mocha');
const {assert} = require('chai');
const debugLib = require('debug');
const sinon = require('sinon').createSandbox();

const {getNewTestFactory} = require('../testFactory');
const factory = getNewTestFactory();
const {generateAddress, processBlock} = require('../testUtil');
const {arrayEquals, prepareForStringifyObject} = require('../../utils');

process.on('warning', e => console.warn(e.stack));

const CONCILIUM_CREATE_FEE = 1e6;
const CONCILIUM_INVOKE_FEE = 1e6;

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
let witnessThree;
let nodeThree;
let nodeFour;

let stepDone = false;

describe('Genesis net tests (it runs one by one!)', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();

        seedAddress = factory.Transport.generateAddress();
        factory.Constants.DNS_SEED = [seedAddress];
        factory.Constants.PEER_RECONNECT_INTERVAL = 20000;
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
        assert.isOk(Array.isArray(arrWitnesses) && arrWitnesses.length === 3);

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
            delay,
            workerSuspended: false
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
            delay,
            workerSuspended: false
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

        const txCode = createAnotherConcilium(wallet.privateKey, moneyIssueTx.hash(), 4);
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

        stepDone = true;
    });

    it('should join & start witness concilium', async function() {
        this.timeout(300000);

        const wallet = witnessConciliumTwo._wallet;

        // use next (5th output)
        const txCode = joinConcilium(wallet.privateKey, moneyIssueTx.hash(), 5, 1e5);
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

        const concilium = await witnessConciliumTwo._storage.getConciliumById(1);
        assert.isOk(concilium);
        assert.isOk(Array.isArray(concilium.getAddresses()));
        assert.isOk(concilium.getAddresses().length === 1);
        assert.isOk(concilium.getAddresses()[0].toString('hex') === wallet.address);

        await witnessConciliumTwo.start();

        stepDone = true;
    });

    it('should be 0 pending & 3 stable blocks', async () => {
        assert.equal(witnessConciliumOne._pendingBlocks.getAllHashes().length, 0);
        assert.equal(witnessConciliumTwo._pendingBlocks.getAllHashes().length, 0);

        // all blocks
        assert.equal(witnessConciliumOne._mainDag.order, 3);
        assert.equal(witnessConciliumTwo._mainDag.order, 3);

        stepDone = true;
    });

    it('should produce block for second concilium', async function() {
        this.timeout(300000);

        const wallet = new factory.Wallet(arrWitnesses[1].privateKey);

        // create TX for new concilium (id: 1)
        const tx = sendMoneys(wallet.privateKey, moneyIssueTx.hash(), 6, 1);

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
        assert.equal(witnessConciliumOne._mainDag.order, 4);
        assert.equal(witnessConciliumTwo._pendingBlocks.getAllHashes().length, 1);
        assert.equal(witnessConciliumTwo._mainDag.order, 4);

        stepDone = true;
    });

    it('should be same LAST_APPLIED_BLOCKS for both witnesses', async () => {
        const arrHashesOne = await witnessConciliumOne._storage.getLastAppliedBlockHashes();
        const arrHashesTwo = await witnessConciliumTwo._storage.getLastAppliedBlockHashes();

        assert.isOk(arrayEquals(arrHashesOne, arrHashesTwo));
        assert.equal(arrHashesOne.length, 1);

        stepDone = true;
    });

    it('should create 3d witness & join concilium', async function() {
        this.timeout(300000);

        const wallet = new factory.Wallet(arrWitnesses[2].privateKey);
        witnessThree = new factory.Witness({
            wallet,
            arrSeedAddresses: [seedAddress],
            delay,
            workerSuspended: false
        });
        await witnessThree.ensureLoaded();
        await witnessThree.bootstrap();

        // wait to 4 block (including one with concilium 1 definition)
        await (new Promise((resolve, reject) => {
            sinon.stub(witnessThree, '_postAcceptBlock').callsFake(() => {
                if (witnessThree._mainDag.order === 4) {
                    resolve();
                }
            });
        }));
        sinon.restore();

        const txCode = joinConcilium(wallet.privateKey, moneyIssueTx.hash(), 8, 1e5);
        await witnessThree.rpcHandler({event: 'tx', content: txCode});

        // wait for witnessOne receive tx & produce block with concilium invocation & send us (witnessThree) that block
        const donePromise = new Promise((resolve, reject) => {
            sinon.stub(witnessThree, '_postAcceptBlock').callsFake((block) => {
                if (block.conciliumId === 0 && block.txns.length === 2) {
                    resolve();
                }
            });
        });

        await donePromise;

        // block with updated concilium arrived, but it's "unstable" so, we need concilium 1 (which still have one witness) produce a block

        stepDone = true;
    });

    it('should create block at concilium 1 (to make block with join stable)', async function() {
        this.timeout(300000);

        const wallet = witnessThree._wallet;

        const txCode = sendMoneys(wallet.privateKey, moneyIssueTx.hash(), 9, 1);
        await witnessThree.rpcHandler({event: 'tx', content: txCode});

        {
            // wait for witnessTwo receive tx & produce block & send us (witnessThree) that block
            const donePromise = new Promise((resolve, reject) => {
                sinon.stub(witnessThree, '_postAcceptBlock').callsFake((block) => {
                    if (block.conciliumId === 1 && block.txns.length === 2) {
                        resolve();
                    }
                });
            });

            await donePromise;
        }

        const concilium = await witnessThree._storage.getConciliumById(1);
        assert.isOk(concilium);
        assert.isOk(Array.isArray(concilium.getAddresses()));
        assert.isOk(concilium.getAddresses().length === 2);
        assert.isOk(concilium.getAddresses()[1].toString('hex') === wallet.address);

        await witnessThree.start();

        stepDone = true;
    });

    it('should create ONE MORE block at concilium 1 (now with 2 witnesses)', async function() {
        this.timeout(300000);

        const wallet = witnessThree._wallet;

        const txCode = sendMoneys(wallet.privateKey, moneyIssueTx.hash(), 10, 1);
        await witnessThree.rpcHandler({event: 'tx', content: txCode});

        {
            // wait for witnessTwo receive tx & produce block & send us (witnessThree) that block
            const donePromise = new Promise((resolve, reject) => {
                sinon.stub(witnessThree, '_postAcceptBlock').callsFake((block) => {
                    if (block.txns.length === 2) {
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

});

function createGenesisBlock() {
    const witnessOne = factory.Crypto.createKeyPair();
    const witnessTwo = factory.Crypto.createKeyPair();
    const witnessThree = factory.Crypto.createKeyPair();

    const initialConcilium = factory.ConciliumRr.create(0, [witnessOne.address], 1);

    const contractCode = `
class ContractConciliums extends Base {
    constructor(objInitialConcilium, nFeeCreate) {
        super();
        this._arrConciliums = [];
        if (!objInitialConcilium) throw('Specify initial objInitialConcilium');

        this._arrConciliums.push({
            ...objInitialConcilium,
            conciliumCreationTx: contractTx
        });

        if (nFeeCreate) this.setFeeCreate(nFeeCreate);
        this._proxyAddress = undefined;
    }

    async createConcilium(objConcilium) {
        objConcilium._creator = callerAddress;

        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {method: "createConcilium", arrArguments: [objConcilium]});
        }

        this._checkFeeCreate(value);
        this._validateConcilium(objConcilium);

        this._arrConciliums.push({
            ...objConcilium,
            conciliumId: this._arrConciliums.length,
            conciliumCreationTx: contractTx
        });
    }

    async joinConcilium(conciliumId) {
        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {method: "joinConcilium", arrArguments: [conciliumId]});
        }

        const objConcilium = this._checkConciliumId(conciliumId);

        if (!objConcilium.isOpen) throw ('You cant join this concilium. Ask about invitation');

        if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS}) {
            this._addPosConciliumMember(objConcilium, callerAddress);
        } else if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_RR}) {
            this._addRrConciliumMember(objConcilium, callerAddress);
        }
    }

    async leaveConcilium(conciliumId) {
        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {method: "leaveConcilium", arrArguments: [conciliumId]});
        }

        const objConcilium = this._checkConciliumId(conciliumId);

        if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS}) {
            this._retirePosConciliumMember(objConcilium, callerAddress);
        } else if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_RR}) {
            this._retireRrConciliumMember(objConcilium, callerAddress);
        }
    }

    async inviteToConcilium(conciliumId, arrAddresses) {
        if (this._proxyAddress) {
            return await delegatecall(
                this._proxyAddress,
                {method: "inviteToConcilium", arrArguments: [conciliumId, arrAddresses]}
            );
        }

        const objConcilium = this._checkConciliumId(conciliumId);
        this._checkCreator(objConcilium, callerAddress);

        if (objConcilium.isOpen) throw ('This concilium is open, just join it');

        if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_RR}) {
            throw ('this method only for CONCILIUM_TYPE_RR');
        }

        this._addRrConciliumMember(objConcilium, callerAddress);
    }

    setFeeCreate(nFeeNew) {
        this._checkOwner();
        this._feeCreate = nFeeNew;
    }

    setProxy(strNewAddress) {
        if (strNewAddress.length !== 40) throw ('Bad address');

        this._checkOwner();
        this._proxyAddress = strNewAddress;
    }

    async getHeightToRelease(conciliumId) {
        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress, {method: "getHeightToRelease", arrArguments: [conciliumId]});
        }

        const objConcilium = this._checkConciliumId(conciliumId);

        if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS}) {
            throw ('this method only for CONCILIUM_TYPE_POS');
        }

        return this._getPosHieghtToRelease(objConcilium, callerAddress);
    }

    async changeConciliumParameters(objNewParameters) {
        if (this._proxyAddress) {
            return await delegatecall(this._proxyAddress,
                {method: "changeConciliumParameters", arrArguments: [objNewParameters]}
            );
        }
        throw('Not implemente yet');
    }

    // PoS concilium
    _posConciliumMemberExists(objConcilium, callerAddress) {
        if (!Array.isArray(objConcilium.arrMembers)) objConcilium.arrMembers = [];
        return !objConcilium.arrMembers.every(objExistedMember => objExistedMember.address !== callerAddress);
    }

    _addPosConciliumMember(objConcilium) {
        if (this._posConciliumMemberExists(objConcilium, callerAddress)) throw ('already joined');

        this._checkDepositJoin(objConcilium, value);

        objConcilium.arrMembers.push({
            address: callerAddress,
            amount: value,
            nHeightToRelease: block.height +${factory.Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON}
        });
    }

    _retirePosConciliumMember(objConcilium, callerAddress) {
        const idx = objConcilium.arrMembers.findIndex(member => member.address === callerAddress);
        if (!~idx) throw ('You aren\\'t member');

        const objMember = objConcilium.arrMembers[idx];
        if (objMember.nHeightToRelease > block.height) throw ('Don\\'t leave us now');

        send(objMember.address, objMember.amount);
        objConcilium.arrMembers.splice(idx, 1);
    }

    _checkDepositJoin(objConcilium, value) {
        if (value < objConcilium.nMinAmountToJoin) {
            throw ('You should send at least ' + objConcilium.nMinAmountToJoin + 'coins');
        }
    }

    _getPosHieghtToRelease(objConcilium, callerAddress) {
        const idx = objConcilium.arrMembers.findIndex(member => member.address === callerAddress);
        if (!~idx) throw ('You aren\\'t member');

        const objMember = objConcilium.arrMembers[idx];
        return objMember.nHeightToRelease;
    }

    // Round robin concilium
    _rRConciliumMemberExists(objConcilium, callerAddress) {
        if (!Array.isArray(objConcilium.addresses)) objConcilium.addresses = [];
        return !objConcilium.addresses.every(strMemberAddr => strMemberAddr !== callerAddress);
    }

    _addRrConciliumMember(objConcilium, callerAddress) {
        if (this._rRConciliumMemberExists(objConcilium, callerAddress)) throw ('already joined');
        objConcilium.addresses.push(callerAddress);
    }

    _retireRrConciliumMember(objConcilium, callerAddress) {
        const idx = objConcilium.addresses.findIndex(addr => addr === callerAddress);
        if (!~idx) throw ('You aren\\'t member');
        objConcilium.addresses.splice(idx, 1);
    }

    // common
    _checkConciliumId(conciliumId) {
        if (conciliumId > this._arrConciliums.length || conciliumId < 0) throw ('Bad conciliumId');
        return this._arrConciliums[conciliumId];
    }

    _checkFeeCreate(nFee) {
        if (!this._feeCreate) throw ('Set _feeCreate first');
        if (this._feeCreate > nFee) throw ('Not enough funds');
    }

    _checkCreator(objConcilium, callerAddress) {
        if (objConcilium._creator !== callerAddress) throw ('Unauthorized call');
    }

    _validateConcilium(objConcilium) {
        if (objConcilium.type === ${factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS}) {
            if (!Array.isArray(objConcilium.arrMembers)) objConcilium.arrMembers = [];

            if (!objConcilium.nMinAmountToJoin || objConcilium.nMinAmountToJoin < 0) throw ('Specify nMinAmountToJoin');

            const initialAmount = objConcilium.arrMembers.reduce((accum, objMember) => accum + objMember.amount, 0);
            if (this._feeCreate + initialAmount > value) throw ('Not enough coins were sent co create such concilium');
        }
    }
};

exports=new ContractConciliums(${JSON.stringify(
        prepareForStringifyObject(initialConcilium.toObject()))}, ${CONCILIUM_CREATE_FEE});
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
    moneyIssueTx.addReceiver(1e8, witnessThree.getAddress());
    moneyIssueTx.addReceiver(1e8, witnessThree.getAddress());
    moneyIssueTx.addReceiver(1e8, witnessThree.getAddress());
    moneyIssueTx.addReceiver(1e8, witnessThree.getAddress());

    const contractDeployTx = factory.Transaction.createContract(contractCode);

    genesis.addTx(moneyIssueTx);
    genesis.addTx(contractDeployTx);
    genesis.setHeight(1);
    genesis.finish(factory.Constants.fees.TX_FEE, generateAddress());

    console.log(`Genesis hash: ${genesis.getHash()}`);
    return {
        genesis,
        strConciliumDefContractTx: contractDeployTx.hash(),
        arrWitnesses: [witnessOne, witnessTwo, witnessThree],
        moneyIssueTx
    };
}

function createAnotherConcilium(strClaimPrivateKey, utxo, idx) {
    console.log(`Using UTXo ${utxo} idx ${idx}`);

    const concilium = new factory.ConciliumPos({
        conciliumId: 1,
        nMinAmountToJoin: 1e3,
        isOpen: true,
        arrMembers: []
    });

    const contractCode = {
        method: 'createConcilium',
        arrArguments: [
            concilium.toObject()
        ]
    };

    // WARNING! it's just test/demo. All coins at this UTXO become fee
    const tx = factory.Transaction.invokeContract(
        factory.Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS,
        contractCode,
        CONCILIUM_CREATE_FEE + 1e3
    );

    // spend witness2 coins (WHOLE!)
    tx.addInput(utxo, idx);
    tx.claim(0, strClaimPrivateKey);

    return tx;
}

function joinConcilium(strClaimPrivateKey, utxo, idx, amount) {
    console.log(`Using UTXo ${utxo} idx ${idx}`);

    const contractCode = {
        method: 'joinConcilium',
        arrArguments: [1]
    };

    // WARNING! it's just test/demo. All coins at this UTXO become fee
    const tx = factory.Transaction.invokeContract(
        factory.Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS,
        contractCode,
        amount
    );

    // spend coins (WHOLE!)
    tx.addInput(utxo, idx);
    tx.claim(0, strClaimPrivateKey);
    tx.signForContract(strClaimPrivateKey);

    return tx;
}

function sendMoneys(strClaimPrivateKey, utxo, idx, conciliumId = 0) {
    console.log(`Using UTXo ${utxo} idx ${idx}`);

    const tx = new factory.Transaction();
    tx.conciliumId = conciliumId;

    tx.addInput(utxo, idx);
    tx.addReceiver(1e4, generateAddress());
    tx.claim(0, strClaimPrivateKey);

    return tx;
}
