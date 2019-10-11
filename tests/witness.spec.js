'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');
const debug = require('debug')('witness:');

const factory = require('./testFactory');

const {createDummyTx, pseudoRandomBuffer} = require('./testUtil');
const {arrayEquals} = require('../utils');

let wallet;

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

const createDummyPeerInfo = (pubkey, address) => createDummyPeer(pubkey, address).peerInfo;

const createDummyDefinitionWallet = (conciliumId = 0) => {
    const keyPair1 = factory.Crypto.createKeyPair();
    const keyPair2 = factory.Crypto.createKeyPair();
    const newWallet = new factory.Wallet(keyPair1.privateKey);

    const concilium = factory.ConciliumRr.create(conciliumId,
        [keyPair1.publicKey, keyPair2.publicKey]
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

        const peer1 = createDummyPeer(keyPair1.publicKey);
        const peer2 = createDummyPeer('notWitness1');
        const peer3 = createDummyPeer('1111');
        const peer4 = createDummyPeer(keyPair2.publicKey);
        for (let peer of [peer1, peer2, peer3, peer4]) {
            await witness._peerManager.addPeer(peer);
        }

        const result = await witness._getConciliumPeers(concilium);
        assert.isOk(Array.isArray(result));
        assert.equal(result.length, 2);
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
            witness._mempool.getFinalTxns = () => new Array(200).fill(1).map(() => createDummyTx());
            witness._calcHeight = () => 1;
            witness._pendingBlocks.getBestParents = () => ({
                arrParents: [pseudoRandomBuffer().toString('hex')],
                patchMerged: new factory.PatchDB()
            });

            const {block} = await witness._createBlock(0);

            // plus coinbase, plus that tx, which exec exceed time per block
            assert.equal(block.txns.length,
                1 + 1 + parseInt(factory.Constants.blockCreationTimeLimit / nFakeTimePerTx)
            );
        });
    });
});
