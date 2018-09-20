'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');
const debug = require('debug')('witness:');

const factory = require('./testFactory');

const {createDummyTx} = require('./testUtil');

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
        const {witness, groupDefinition} = createDummyWitness();

        const tx1 = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());

        witness._mempool.addTx(tx1);
        witness._mempool.addTx(tx2);

        const block = await witness._createBlock(groupDefinition.getGroupId());
        assert.equal(block.txns.length, 2);
    });

    it('should NOT broadcast block (hold off timer)', async () => {
        const {witness, groupDefinition} = createDummyWitness();

        await witness.start();
        const consensusInstance = witness._consensuses.get(groupDefinition.getGroupName());
        try {
            await witness._createBlockAndBroadcast(consensusInstance);
        } catch (e) {
            if (typeof e === 'number') return;
            console.error(e);
        }
        throw new Error('Unexpected success');
    });

    it('should broadcast block', async () => {
        const {witness, groupDefinition} = createDummyWitness();

        await witness.start();
        const consensusInstance = witness._consensuses.get(groupDefinition.getGroupName());
        consensusInstance.timeForWitnessBlock = sinon.fake.returns(true);
        witness._peerManager.broadcastToConnected = sinon.fake();

        const block = await witness._createBlockAndBroadcast(consensusInstance);

        assert.isOk(block);
        assert.isOk(block.isEmpty());
        assert.isOk(consensusInstance.timeForWitnessBlock.calledOnce);
        assert.isOk(witness._peerManager.broadcastToConnected.calledOnce);
    });

});
