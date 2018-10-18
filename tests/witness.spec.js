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
            address
        }
    });

const createDummyPeerInfo = (pubkey, address) => createDummyPeer(pubkey, address).peerInfo;

const createDummyDefinitionWallet = (groupName, groupId = 0) => {
    const keyPair1 = factory.Crypto.createKeyPair();
    const keyPair2 = factory.Crypto.createKeyPair();
    const newWallet = new factory.Wallet(keyPair1.privateKey);

    const groupDefinition = factory.WitnessGroupDefinition.create(groupName, groupId,
        [keyPair1.publicKey, keyPair2.publicKey]
    );

    return {keyPair1, keyPair2, groupDefinition, newWallet};
};

const createDummyWitness = () => {
    const groupName = 'test';

    const {groupDefinition, newWallet} = createDummyDefinitionWallet(groupName);
    const witness = new factory.Witness({wallet: newWallet, arrTestDefinition: [groupDefinition]});

    return {witness, groupDefinition};
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
        const groupName = 'test';
        const {keyPair1, keyPair2, groupDefinition} = createDummyDefinitionWallet(groupName);
        const witness = new factory.Witness({wallet, arrTestDefinition: [groupDefinition]});

        const peer1 = createDummyPeer(keyPair1.publicKey);
        const peer2 = createDummyPeer('notWitness1');
        const peer3 = createDummyPeer('1111');
        const peer4 = createDummyPeer(keyPair2.publicKey);
        [peer1, peer2, peer3, peer4].forEach(peer => witness._peerManager.addPeer(peer));

        const result = await witness._getGroupPeers(groupDefinition);
        assert.isOk(Array.isArray(result));
        assert.equal(result.length, 2);
    });

    it('should reject message with wrong signature prom peer', async () => {
        const groupName = 'test';

        // mock peer with public key from group
        const peer = createDummyPeer();

        const def = factory.WitnessGroupDefinition.create(groupName, 0,
            [wallet.publicKey, Buffer.from('pubkey1'), Buffer.from('pubkey2')]
        );
        const arrTestDefinition = [def];

        // create witness
        const witness = new factory.Witness({wallet, arrTestDefinition});
        await witness._createConsensusForGroup(def);
        const newBft = witness._consensuses.get(def.getGroupName());
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
        factory.Constants.GENEZIS_BLOCK = pseudoRandomBuffer().toString('hex');

        const {witness, groupDefinition} = createDummyWitness();

        const patch = new factory.PatchDB();
        const txHash = pseudoRandomBuffer().toString('hex');
        const coins = new factory.Coins(100000, Buffer.from(witness._wallet.address, 'hex'));
        patch.createCoins(txHash, 1, coins);
        patch.createCoins(txHash, 2, coins);
        patch.createCoins(txHash, 3, coins);
        await witness._storage.applyPatch(patch);

        const tx1 = new factory.Transaction();
        tx1.addInput(txHash, 1);
        tx1.addReceiver(1000, Buffer.from(witness._wallet.address, 'hex'));
        tx1.sign(0, witness._wallet.privateKey);
        const tx2 = new factory.Transaction();
        tx2.addInput(txHash, 2);
        tx2.addReceiver(1000, Buffer.from(witness._wallet.address, 'hex'));
        tx2.sign(0, witness._wallet.privateKey);

        witness._mempool.addTx(tx1);
        witness._mempool.addTx(tx2);

        const {block} = await witness._createBlock(groupDefinition.getGroupId());
        assert.equal(block.txns.length, 3);
    });

    describe('Tips selection', async () => {

        it('should test _getVertexWitnessNum', async () => {
            const node = new factory.Node({});

            node._dagPendingBlocks.add('hash3', 'hash1');
            node._dagPendingBlocks.add('hash2', 'hash1');
            node._dagPendingBlocks.add('hash4', 'hash2');

            node._dagPendingBlocks.saveObj('hash1', {blockHeader: {witnessGroupId: 0}, patch: new factory.PatchDB()});
            node._dagPendingBlocks.saveObj('hash3', {blockHeader: {witnessGroupId: 0}, patch: new factory.PatchDB()});
            node._dagPendingBlocks.saveObj('hash2', {blockHeader: {witnessGroupId: 2}, patch: new factory.PatchDB()});
            node._dagPendingBlocks.saveObj('hash4', {blockHeader: {witnessGroupId: 3}, patch: new factory.PatchDB()});

            assert.isOk(node._getVertexWitnessNum('hash1') === 1);
            assert.isOk(node._getVertexWitnessNum('hash3') === 1);
            assert.isOk(node._getVertexWitnessNum('hash2') === 2);
            assert.isOk(node._getVertexWitnessNum('hash4') === 3);
        });

        it('should select all 3 tips', async () => {
            const {witness} = createDummyWitness();

            witness._dagPendingBlocks.addVertex('hash1');
            witness._dagPendingBlocks.addVertex('hash2');
            witness._dagPendingBlocks.addVertex('hash3');

            const arrTips = witness._getTips();
            assert.isOk(arrTips.length, 3);
            assert.isOk(arrayEquals(arrTips, ['hash1', 'hash2', 'hash3']));
        });

        it('should select 2 tips', async () => {
            const {witness} = createDummyWitness();

            witness._dagPendingBlocks.addVertex('hash1');
            witness._dagPendingBlocks.addVertex('hash2');
            witness._dagPendingBlocks.addVertex('hash3');

            witness._dagPendingBlocks.add('hash3', 'hash2');

            const arrTips = witness._getTips();
            assert.isOk(arrTips.length, 2);
            assert.isOk(arrayEquals(arrTips, ['hash1', 'hash3']));
        });

        it('should select all 3 parents (no conflicts) and set mci', async () => {
            const {witness} = createDummyWitness();

            witness._dagPendingBlocks.addVertex('hash1');
            witness._dagPendingBlocks.addVertex('hash2');
            witness._dagPendingBlocks.addVertex('hash3');

            witness._dagPendingBlocks.saveObj('hash1',
                {blockHeader: {witnessGroupId: 1, mci: 2}, patch: new factory.PatchDB()}
            );
            witness._dagPendingBlocks.saveObj('hash2',
                {blockHeader: {witnessGroupId: 2, mci: 3}, patch: new factory.PatchDB()}
            );
            witness._dagPendingBlocks.saveObj('hash3',
                {blockHeader: {witnessGroupId: 3, mci: 100}, patch: new factory.PatchDB()}
            );

            const {arrParents, mci} = await witness._getBestParents(['hash1', 'hash2', 'hash3']);
            assert.isOk(arrParents.length, 3);
            assert.isOk(arrayEquals(arrParents, ['hash1', 'hash2', 'hash3']));
            assert.isOk(mci === 101);
        });

        it('should select only 1 parent (conflict)', async () => {
            const {witness} = createDummyWitness();

            witness._dagPendingBlocks.addVertex('hash1');
            witness._dagPendingBlocks.addVertex('hash2');

            const patch = new factory.PatchDB();
            patch.merge = sinon.fake.throws();

            witness._dagPendingBlocks.saveObj('hash1',
                {blockHeader: {witnessGroupId: 1, mci: 10}, patch}
            );
            witness._dagPendingBlocks.saveObj('hash2',
                {blockHeader: {witnessGroupId: 2, mci: 20}, patch}
            );

            const {arrParents, mci} = await witness._getBestParents(['hash1', 'hash2']);
            assert.isOk(arrParents.length, 1);
            assert.isOk(arrayEquals(arrParents, ['hash1']));
            assert.isOk(mci === 11);
        });

        it('should select longest chain 3->2 (3 & 1 conflicts)', async () => {
            const {witness} = createDummyWitness();

            witness._dagPendingBlocks.addVertex('hash1');
            witness._dagPendingBlocks.addVertex('hash2');
            witness._dagPendingBlocks.addVertex('hash3');

            witness._dagPendingBlocks.add('hash3', 'hash2');

            const patch = new factory.PatchDB();
            patch.merge = sinon.fake.throws();

            witness._dagPendingBlocks.saveObj('hash1',
                {blockHeader: {witnessGroupId: 1, mci: 10}, patch}
            );
            witness._dagPendingBlocks.saveObj('hash2',
                {blockHeader: {witnessGroupId: 2, mci: 20}, patch}
            );
            witness._dagPendingBlocks.saveObj('hash3',
                {blockHeader: {witnessGroupId: 1, mci: 30}, patch}
            );

            const {arrParents, mci} = await witness._getBestParents(['hash1', 'hash3']);
            assert.isOk(arrParents.length, 1);
            assert.isOk(arrayEquals(arrParents, ['hash3']));
            assert.isOk(mci === 31);
        });

        it('should call merge 9 times', async () => {

            // because first not merged
            const {witness} = createDummyWitness();

            const patch = new factory.PatchDB();
            patch.merge = sinon.fake.returns(patch);

            for (let i = 1; i < 11; i++) {
                witness._dagPendingBlocks.addVertex(`hash${i}`);
                witness._dagPendingBlocks.saveObj(`hash${i}`, {blockHeader: {witnessGroupId: i, mci: i}, patch});
            }

            await witness._getBestParents(witness._dagPendingBlocks.V);
            assert.isOk(patch.merge.callCount === 9);
        });

        it('should select 2 from 3  (has conflicts)', async () => {
            const {witness} = createDummyWitness();

            witness._dagPendingBlocks.addVertex('hash1');
            witness._dagPendingBlocks.addVertex('hash2');
            witness._dagPendingBlocks.addVertex('hash3');
            witness._dagPendingBlocks.addVertex('hash4');

            witness._dagPendingBlocks.add('hash3', 'hash2');

            let callCount = 0;
            const patch = new factory.PatchDB();
            patch.merge = () => {

                // really it's a second merge. first merge with self made by assignment
                if (++callCount === 1) {
                    throw new Error('Conflict');
                }
            };

            witness._dagPendingBlocks.saveObj('hash1',
                {blockHeader: {witnessGroupId: 1, mci: 10}, patch}
            );
            witness._dagPendingBlocks.saveObj('hash2',
                {blockHeader: {witnessGroupId: 2, mci: 20}, patch}
            );
            witness._dagPendingBlocks.saveObj('hash3',
                {blockHeader: {witnessGroupId: 1, mci: 30}, patch}
            );
            witness._dagPendingBlocks.saveObj('hash4',
                {blockHeader: {witnessGroupId: 1, mci: 40}, patch}
            );

            const {arrParents, mci} = await witness._getBestParents(['hash1', 'hash3', 'hash4']);
            assert.isOk(arrParents.length === 2);

            // 'hash1' - conflicts
            assert.isOk(arrayEquals(arrParents, ['hash3', 'hash4']));
            assert.isOk(mci === 41);
        });
    });

});
