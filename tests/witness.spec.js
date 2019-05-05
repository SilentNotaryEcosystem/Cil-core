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

const createDummyDefinitionWallet = (groupId = 0) => {
    const keyPair1 = factory.Crypto.createKeyPair();
    const keyPair2 = factory.Crypto.createKeyPair();
    const newWallet = new factory.Wallet(keyPair1.privateKey);

    const concilium = factory.ConciliumDefinition.create(groupId,
        [keyPair1.publicKey, keyPair2.publicKey]
    );

    return {keyPair1, keyPair2, concilium, newWallet};
};

const createDummyWitness = () => {
    const {concilium, newWallet} = createDummyDefinitionWallet();
    const witness = new factory.Witness({wallet: newWallet, arrTestDefinition: [concilium]});

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

    it('should get peers for my group', async () => {
        const groupId = 0;
        const {keyPair1, keyPair2, concilium} = createDummyDefinitionWallet(groupId);
        const witness = new factory.Witness({wallet, arrTestDefinition: [concilium], isSeed: true});
        await witness.ensureLoaded();

        const peer1 = createDummyPeer(keyPair1.publicKey);
        const peer2 = createDummyPeer('notWitness1');
        const peer3 = createDummyPeer('1111');
        const peer4 = createDummyPeer(keyPair2.publicKey);
        for (let peer of [peer1, peer2, peer3, peer4]) {
            await witness._peerManager.addPeer(peer);
        }

        const result = await witness._getGroupPeers(concilium);
        assert.isOk(Array.isArray(result));
        assert.equal(result.length, 2);
    });

    it('should reject message with wrong signature prom peer', async () => {
        const groupId = 11;

        // mock peer with public key from group
        const peer = createDummyPeer();

        const def = factory.ConciliumDefinition.create(
            groupId,
            [wallet.publicKey, Buffer.from('pubkey1'), Buffer.from('pubkey2')]
        );
        const arrTestDefinition = [def];

        // create witness
        const witness = new factory.Witness({wallet, arrTestDefinition});
        await witness._createConsensusForGroup(def);
        const newBft = witness._consensuses.get(def.getGroupId());
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

        const {block, patch} = await witness._createBlock(concilium.getGroupId());
        assert.equal(block.txns.length, 3);

        assert.isOk(patch.getUtxo(new factory.Transaction(block.txns[0]).hash()));
    });
});
