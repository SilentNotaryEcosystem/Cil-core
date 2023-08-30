'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');
const debug = require('debug')('witness:');

const factory = require('./testFactory');

const {createDummyTx, createDummyBlock, pseudoRandomBuffer, generateAddress} = require('./testUtil');
const {arrayEquals} = require('../utils');

let wallet;

const createDummyUtxo = (arrIndexes, amount = 10, receiver = generateAddress()) => {
    const txHash = pseudoRandomBuffer().toString('hex');
    const utxo = new factory.UTXO({txHash});
    const coins = new factory.Coins(amount, receiver);

    arrIndexes.forEach(idx => utxo.addCoins(idx, coins));

    return utxo;
};

const createDummyPeer = (pubkey = '0a0b0c0d', address = factory.Transport.generateAddress()) =>
    new factory.Peer({
        peerInfo: {
            capabilities: [
                {service: factory.Constants.NODE, data: null},
                {service: factory.Constants.WITNESS, data: Buffer.from(pubkey, 'hex')}
            ],
            address: factory.Transport.strToAddress(address)
        }
    });

const createDummyDefinitionWallet = (conciliumId = 0) => {
    const keyPair1 = factory.Crypto.createKeyPair();
    const keyPair2 = factory.Crypto.createKeyPair();
    const newWallet = new factory.Wallet(keyPair1.privateKey);

    const concilium = factory.ConciliumRr.create(conciliumId,
        [keyPair1.address, keyPair2.address]
    );

    return {keyPair1, keyPair2, concilium, newWallet};
};

const createDummyWitness = () => {
    const {concilium, newWallet} = createDummyDefinitionWallet();
    const witness = new factory.Witness({wallet: newWallet, workerSuspended: true, networkSuspended: true});
    witness._storage.getConciliumsByAddress = async () => [concilium];
    witness._storage.getConciliumById = async () => concilium;

    return {witness, concilium};
};

describe('Witness tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();

        wallet = new factory.Wallet('b7760a01705490e5e153a6ef7732369a72dbf9aaafb5c482cdfd960546909ec1');
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should NOT create witness', async () => {
        const wrapper = () => new factory.Witness();
        assert.throws(wrapper);
    });

    it('should create witness', function() {
        new factory.Witness({wallet});
    });

    it('should get peers for my concilium', async () => {
        const conciliumId = 0;
        const {keyPair1, keyPair2, concilium} = createDummyDefinitionWallet(conciliumId);
        const witness = new factory.Witness({wallet, arrTestDefinition: [concilium], isSeed: true});
        await witness.ensureLoaded();

        const peer1 = createDummyPeer(keyPair1.address);
        const peer2 = createDummyPeer('notWitness1');
        const peer3 = createDummyPeer('1111');
        const peer4 = createDummyPeer(keyPair2.address);
        for (let peer of [peer1, peer2, peer3, peer4]) {
            await witness._peerManager.addPeer(peer);
        }

        const result = await witness._getConciliumPeers(concilium);
        assert.isOk(Array.isArray(result));
        assert.equal(result.length, 2);
        assert.equal(result[0].witnessAddress, keyPair1.address);
        assert.equal(result[1].witnessAddress, keyPair2.address);
    });

    it('should reject message with wrong signature prom peer', async () => {
        const conciliumId = 11;

        // mock peer with public key from concilium
        const peer = createDummyPeer();

        const def = factory.ConciliumRr.create(
            conciliumId,
            [wallet.publicKey, Buffer.from('pubkey1'), Buffer.from('pubkey2')]
        );
        const arrTestDefinition = [def];

        // create witness
        const witness = new factory.Witness({wallet, arrTestDefinition});
        await witness._createConsensusForConcilium(def);
        const newBft = witness._consensuses.get(def.getConciliumId());
        newBft._stopTimer();

        try {
            await witness._checkPeerAndMessage(peer, undefined);
        } catch (e) {
            debug(e);
            return;
        }
        assert.isOk(false, 'Unexpected success');
    });

    it('should create block', async () => {
        factory.Constants.GENESIS_BLOCK = pseudoRandomBuffer().toString('hex');

        const {witness, concilium} = createDummyWitness();
        await witness.ensureLoaded();

        const patchSource = new factory.PatchDB(0);
        const txHash = pseudoRandomBuffer().toString('hex');
        const coins = new factory.Coins(100000, Buffer.from(witness._wallet.address, 'hex'));
        patchSource.createCoins(txHash, 1, coins);
        patchSource.createCoins(txHash, 2, coins);
        patchSource.createCoins(txHash, 3, coins);
        await witness._storage.applyPatch(patchSource);

        const tx1 = new factory.Transaction();
        tx1.addInput(txHash, 1);
        tx1.addReceiver(1000, Buffer.from(witness._wallet.address, 'hex'));
        tx1.claim(0, witness._wallet.privateKey);
        const tx2 = new factory.Transaction();
        tx2.addInput(txHash, 2);
        tx2.addReceiver(1000, Buffer.from(witness._wallet.address, 'hex'));
        tx2.claim(0, witness._wallet.privateKey);

        witness._mempool.addTx(tx1);
        witness._mempool.addTx(tx2);

        witness._calcHeight = sinon.fake.returns(10);

        const {block} = await witness._createBlock(concilium.getConciliumId());
        assert.equal(block.txns.length, 3);
    });

    it('should _createJoinTx', async () => {
        const {witness, concilium} = createDummyWitness();
        await witness.ensureLoaded();
        const addr = generateAddress();
        const amount = 1e4;
        const arrUtxos = [
            createDummyUtxo([1, 2, 5], amount, addr),
            createDummyUtxo([0], amount, addr)
        ];

        const tx = witness._createJoinTx(arrUtxos, concilium);

        assert.equal(tx.inputs.length, 4);
        assert.equal(tx.outputs.length, 1);
        assert.equal(tx.amountOut(), 4 * amount - 5 * Math.round(factory.Constants.fees.TX_FEE * 0.12));
        assert.equal(tx.claimProofs.length, 0);
        assert.isOk(tx.getTxSignature());
    });

    it('should join no more than MAX', async () => {
        const {witness, concilium} = createDummyWitness();
        await witness.ensureLoaded();
        const addr = generateAddress();
        const amount = 1e4;
        const arrUtxos = [
            createDummyUtxo([1, 2, 5], amount, addr),
            createDummyUtxo([0], amount, addr)
        ];

        const tx = witness._createJoinTx(arrUtxos, concilium, 2);

        assert.equal(tx.inputs.length, 2);
        assert.equal(tx.outputs.length, 1);
    });

    describe('Create block', async () => {
        let clock;
        let witness;
        let concilium;

        beforeEach(async () => {
            ({witness, concilium} = createDummyWitness());
            await witness.ensureLoaded();
            clock = sinon.useFakeTimers();
        });

        afterEach(async () => {
            clock.restore();
        });

        it('should limit time for block creation of 1,5 sec', async () => {
            const nFakeFee = 101;
            const nFakeTimePerTx = 100;
            witness._processTx = async () => {
                clock.tick(nFakeTimePerTx);
                return {fee: nFakeFee, patchThisTx: new factory.PatchDB()};
            };
            witness._mempool.getFinalTxns =
                () => new Array(1000).fill(1).map(() => new factory.Transaction(createDummyTx()));
            witness._calcHeight = () => 1;
            witness._pendingBlocks.getBestParents = () => ({
                arrParents: [pseudoRandomBuffer().toString('hex')],
                patchMerged: new factory.PatchDB()
            });

            const {block} = await witness._createBlock(0);

            // plus coinbase, plus that tx, which exec exceed time per block
            assert.equal(block.txns.length,
                1 + 1 + parseInt(factory.Constants.BLOCK_CREATION_TIME_LIMIT / nFakeTimePerTx)
            );
        });
    });
    describe('_isBigTimeDiff', async () => {
        let witness;
        let concilium;

        beforeEach(async () => {
            ({witness, concilium} = createDummyWitness());
            await witness.ensureLoaded();
        });

        it('should be false', async () => {
            const block = createDummyBlock(factory);
            witness._pendingBlocks.getBlock = sinon.fake.returns({
                blockHeader: {
                    timestamp: block.timestamp - factory.Constants.BLOCK_AUTO_WITNESSING_TIMESTAMP_DIFF + 1
                }
            });

            assert.isNotOk(witness._isBigTimeDiff(block));
        });

        it('should be true (child not found)', async () => {
            const block = createDummyBlock(factory);
            witness._pendingBlocks.getBlock = sinon.fake.returns({});

            assert.isOk(witness._isBigTimeDiff(block));
        });

        it('should be true', async () => {
            const block = createDummyBlock(factory);
            witness._pendingBlocks.getBlock = sinon.fake.returns({
                blockHeader: {
                    timestamp: block.timestamp - factory.Constants.BLOCK_AUTO_WITNESSING_TIMESTAMP_DIFF - 1
                }
            });

            assert.isOk(witness._isBigTimeDiff(block));
        });

        it('should join outputs into single one', async () => {
            const nFakeFee = 101;
            witness._processTx = async () => {
                return {fee: nFakeFee, patchThisTx: new factory.PatchDB()};
            };
            witness._mempool.getFinalTxns =
                () => new Array(10).fill(1).map(() => new factory.Transaction(createDummyTx()));
            witness._calcHeight = () => 1;
            witness._nLowestConciliumId = 0;
            witness._createJoinTx = sinon.fake.returns(new factory.Transaction(createDummyTx()));
            witness._storage.walletListUnspent = async () => new Array(factory.Constants.WITNESS_UTXOS_JOIN + 1);
            witness._pendingBlocks.getBestParents = () => ({
                arrParents: [pseudoRandomBuffer().toString('hex')],
                patchMerged: new factory.PatchDB()
            });

            const {block} = await witness._createBlock(0);

            // coinbase + joinTx + 10 txns in mempool
            assert.equal(block.txns.length, 1 + 1 + 10);
        });
    });

    it("should sort txns (regular first)", async () => {
        const {witness, concilium} = createDummyWitness();
        await witness.ensureLoaded();

        witness._mempool.getFinalTxns = () => [
            new factory.Transaction(createDummyTx()),
            factory.Transaction.createContract('', generateAddress()),
            factory.Transaction.invokeContract(
                generateAddress().toString('hex'),
                {},
                0
            ),
            new factory.Transaction(createDummyTx())
        ];

        const arrTxns = await witness._gatherTxns(concilium);

        assert.deepEqual(arrTxns.map(tx => tx.isContract()), [false, false, true, true]);
    });
});
