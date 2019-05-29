const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');

const {sleep} = require('../utils');
const {pseudoRandomBuffer, createDummyBlock} = require('./testUtil');

factory = require('./testFactory');

let myWallet;
const groupId = 0;
let BFT;

const createDummyBFT = (groupId = 0, numOfKeys = 2) => {
    const arrKeyPairs = [];
    const arrPublicKeys = [];
    for (let i = 0; i < numOfKeys; i++) {
        const keyPair = factory.Crypto.createKeyPair();
        arrKeyPairs.push(keyPair);
        arrPublicKeys.push(keyPair.publicKey);
    }
    const newWallet = new factory.Wallet(arrKeyPairs[0].privateKey);

    const groupDefinition = factory.WitnessGroupDefinition.create(groupId, arrPublicKeys);

    const newBft = new factory.BFT({
        groupDefinition,
        wallet: newWallet
    });
    newBft._stopTimer();

    return {arrKeyPairs, newWallet, groupDefinition, newBft};
};

describe('BFT general tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
        BFT = factory.BFT;

        const keyPair = factory.Crypto.createKeyPair();
        myWallet = new factory.Wallet(keyPair.privateKey);
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should get MAJORITY for SOLO witness (group of 2 delegates, but with quorum 1)', async () => {
        const kp1 = factory.Crypto.createKeyPair();
        const kp2 = factory.Crypto.createKeyPair();
        const newWallet = new factory.Wallet(kp1.privateKey);

        const groupDefinition = factory.WitnessGroupDefinition.create(
            groupId,
            [kp1.publicKey, kp2.publicKey],
            undefined,
            1
        );

        const newBft = new factory.BFT({
            groupDefinition,
            wallet: newWallet
        });
        newBft._stopTimer();
        assert.equal(newBft._majority([1, 0]), 1);
        assert.equal(newBft._majority([undefined, 0]), 0);
        assert.equal(newBft._majority([0, undefined]), 0);
    });

    it('should get default MAJORITY (group of 2 delegates, with quorum 2)', async () => {
        const kp1 = factory.Crypto.createKeyPair();
        const kp2 = factory.Crypto.createKeyPair();
        const newWallet = new factory.Wallet(kp1.privateKey);

        const groupDefinition = factory.WitnessGroupDefinition.create(
            groupId,
            [kp1.publicKey, kp2.publicKey],
            undefined
        );

        const newBft = new factory.BFT({
            groupDefinition,
            wallet: newWallet
        });
        newBft._stopTimer();
        assert.equal(newBft._majority([1, 0]), undefined);
        assert.equal(newBft._majority([undefined, undefined]), undefined);
        assert.equal(newBft._majority([1, 1]), 1);
        assert.equal(newBft._majority([0, 0]), 0);
    });

    it('should PASS (one witness)', async () => {
        const {newBft, groupDefinition} = createDummyBFT(groupId, 1);
        const sampleData = {data: 1};
        const [myWalletPubKey] = groupDefinition.getPublicKeys();
        newBft._resetState();
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, myWalletPubKey, sampleData);
        const value = newBft.runConsensus();
        assert.deepEqual(sampleData, value);
    });

    it('should PASS (two witness same data)', async () => {
        const {newBft, groupDefinition} = createDummyBFT(groupId, 2);
        const [myWalletPubKey, anotherPubKey] = groupDefinition.getPublicKeys();
        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, myWalletPubKey, sampleData);

        // my node got version of party
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, anotherPubKey, sampleData);

        // receive party view my version
        newBft._addViewOfNodeWithPubKey(anotherPubKey, myWalletPubKey, sampleData);

        // receive party view of own version
        newBft._addViewOfNodeWithPubKey(anotherPubKey, anotherPubKey, sampleData);
        const value = newBft.runConsensus();
        assert.deepEqual(sampleData, value);
    });

    it('should PASS (two witness same data - BUFFER)', async () => {
        const {newBft, groupDefinition} = createDummyBFT(groupId, 2);
        const [myWalletPubKey, anotherPubKey] = groupDefinition.getPublicKeys();

        const sampleData = Buffer.from('1234');
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, myWalletPubKey, sampleData);

        // my node got version of party
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, anotherPubKey, sampleData);

        // receive party view my version
        newBft._addViewOfNodeWithPubKey(anotherPubKey, myWalletPubKey, sampleData);

        // receive party view of own version
        newBft._addViewOfNodeWithPubKey(anotherPubKey, anotherPubKey, sampleData);
        const value = newBft.runConsensus();
        assert.deepEqual(sampleData, value);
    });

    it('should FAIL (two witness different data)', async () => {
        const {newBft, groupDefinition} = createDummyBFT(groupId, 2);
        const [myWalletPubKey, anotherPubKey] = groupDefinition.getPublicKeys();

        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, myWalletPubKey, sampleData);

        // my node got version of party
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, anotherPubKey, undefined);

        // receive party view my version
        newBft._addViewOfNodeWithPubKey(anotherPubKey, myWalletPubKey, sampleData);

        // receive party view of own version
        newBft._addViewOfNodeWithPubKey(anotherPubKey, anotherPubKey, undefined);
        const value = newBft.runConsensus();
        assert.isNotOk(value);
    });

    it('should FAIL (two witness party tries to forge my data)', async () => {
        const {newBft, groupDefinition} = createDummyBFT(groupId, 2);
        const [myWalletPubKey, anotherPubKey] = groupDefinition.getPublicKeys();

        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, myWalletPubKey, sampleData);

        // my node got version of party
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, anotherPubKey, sampleData);

        // receive party view my version
        newBft._addViewOfNodeWithPubKey(anotherPubKey, myWalletPubKey, undefined);

        // receive party view of own version
        newBft._addViewOfNodeWithPubKey(anotherPubKey, anotherPubKey, sampleData);
        const value = newBft.runConsensus();
        assert.isNotOk(value);
    });

    it('should PASS 3 witness same data', async () => {
        const {newBft, groupDefinition} = createDummyBFT(0, 3);
        const [myWalletPubKey, anotherPubKey, thirdPubKey] = groupDefinition.getPublicKeys();

        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, myWalletPubKey, sampleData);

        // my node got version of 2nd party
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, anotherPubKey, sampleData);

        // my node got version of 3d party
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, 'thirdPubKey', sampleData);

        // receive 2nd party view my version
        newBft._addViewOfNodeWithPubKey(anotherPubKey, myWalletPubKey, sampleData);

        // receive 2nd party view of own version
        newBft._addViewOfNodeWithPubKey(anotherPubKey, anotherPubKey, sampleData);

        // receive from 2nd party version of 3d party
        newBft._addViewOfNodeWithPubKey(anotherPubKey, thirdPubKey, sampleData);

        // receive 3d party view my version
        newBft._addViewOfNodeWithPubKey(thirdPubKey, myWalletPubKey, sampleData);

        // receive 3d party own version
        newBft._addViewOfNodeWithPubKey(thirdPubKey, thirdPubKey, sampleData);

        // receive 3d party own version of 2nd party
        newBft._addViewOfNodeWithPubKey(thirdPubKey, anotherPubKey, sampleData);

        const value = newBft.runConsensus();
        assert.deepEqual(value, sampleData);
    });

    it('should PASS 3 witness (one dead)', async () => {
        const {newBft, groupDefinition} = createDummyBFT(0, 3);
        const [myWalletPubKey, anotherPubKey, thirdPubKey] = groupDefinition.getPublicKeys();

        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, myWalletPubKey, sampleData);

        // my node got version of 2nd party
//        newBft._addViewOfNodeWithPubKey(myWalletPubKey, anotherPubKey, undefined);

        // my node got version of 3d party
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, thirdPubKey, sampleData);

        // receive 2nd party view my version
//        newBft._addViewOfNodeWithPubKey(anotherPubKey, myWalletPubKey, undefined);

        // receive 2nd party view of own version
//        newBft._addViewOfNodeWithPubKey(anotherPubKey, anotherPubKey, undefined);

        // receive from 2nd party version of 3d party
//        newBft._addViewOfNodeWithPubKey(anotherPubKey, thirdPubKey, undefined);

        // receive 3d party view my version
        newBft._addViewOfNodeWithPubKey(thirdPubKey, myWalletPubKey, sampleData);

        // receive 3d party own version
        newBft._addViewOfNodeWithPubKey(thirdPubKey, thirdPubKey, sampleData);

        // receive 3d party own version of 2nd party
//        newBft._addViewOfNodeWithPubKey(thirdPubKey, anotherPubKey, undefined);

        const value = newBft.runConsensus();
        assert.deepEqual(value, sampleData);
    });

    it('should PASS 3 witness (one tries to misbehave)', async () => {
        const {newBft, groupDefinition} = createDummyBFT(0, 3);
        const [myWalletPubKey, anotherPubKey, thirdPubKey] = groupDefinition.getPublicKeys();

        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, myWalletPubKey, sampleData);

        // my node got version of 2nd party
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, anotherPubKey, {data: 13});

        // my node got version of 3d party
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, thirdPubKey, sampleData);

        // receive 2nd party view my version
        newBft._addViewOfNodeWithPubKey(anotherPubKey, myWalletPubKey, {data: 14});

        // receive 2nd party view of own version
        newBft._addViewOfNodeWithPubKey(anotherPubKey, anotherPubKey, {data: 15});

        // receive from 2nd party version of 3d party
        newBft._addViewOfNodeWithPubKey(anotherPubKey, thirdPubKey, {data: 16});

        // receive 3d party view my version
        newBft._addViewOfNodeWithPubKey(thirdPubKey, myWalletPubKey, sampleData);

        // receive 3d party own version
        newBft._addViewOfNodeWithPubKey(thirdPubKey, thirdPubKey, sampleData);

        // receive 3d party own version of 2nd party
        newBft._addViewOfNodeWithPubKey(thirdPubKey, anotherPubKey, {data: 17});

        const value = newBft.runConsensus();
        assert.deepEqual(value, sampleData);
    });

    it('should PASS 3 witness (MY data is wrong)', async () => {
        const {newBft, groupDefinition} = createDummyBFT(0, 3);
        const [myWalletPubKey, anotherPubKey, thirdPubKey] = groupDefinition.getPublicKeys();

        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, myWalletPubKey, {data: 11});

        // my node got version of 2nd party
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, anotherPubKey, sampleData);

        // my node got version of 3d party
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, thirdPubKey, sampleData);

        // receive 2nd party view my version
        newBft._addViewOfNodeWithPubKey(anotherPubKey, myWalletPubKey, {data: 11});

        // receive 2nd party view of own version
        newBft._addViewOfNodeWithPubKey(anotherPubKey, anotherPubKey, sampleData);

        // receive from 2nd party version of 3d party
        newBft._addViewOfNodeWithPubKey(anotherPubKey, thirdPubKey, sampleData);

        // receive 3d party view my version
        newBft._addViewOfNodeWithPubKey(thirdPubKey, myWalletPubKey, {data: 11});

        // receive 3d party own version
        newBft._addViewOfNodeWithPubKey(thirdPubKey, thirdPubKey, sampleData);

        // receive 3d party own version of 2nd party
        newBft._addViewOfNodeWithPubKey(thirdPubKey, anotherPubKey, sampleData);

        const value = newBft.runConsensus();
        assert.deepEqual(value, sampleData);
    });

    it('should FAIL 3 witness (two tries to misbehave)', async () => {
        const {newBft, groupDefinition} = createDummyBFT(0, 3);
        const [myWalletPubKey, anotherPubKey, thirdPubKey] = groupDefinition.getPublicKeys();

        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, myWalletPubKey, sampleData);

        // my node got version of 2nd party
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, anotherPubKey, {data: 13});

        // my node got version of 3d party
        newBft._addViewOfNodeWithPubKey(myWalletPubKey, thirdPubKey, {data: 23});

        // receive 2nd party view my version
        newBft._addViewOfNodeWithPubKey(anotherPubKey, myWalletPubKey, {data: 14});

        // receive 2nd party view of own version
        newBft._addViewOfNodeWithPubKey(anotherPubKey, anotherPubKey, {data: 15});

        // receive from 2nd party version of 3d party
        newBft._addViewOfNodeWithPubKey(anotherPubKey, thirdPubKey, {data: 16});

        // receive 3d party view my version
        newBft._addViewOfNodeWithPubKey(thirdPubKey, myWalletPubKey, {data: 24});

        // receive 3d party own version
        newBft._addViewOfNodeWithPubKey(thirdPubKey, thirdPubKey, {data: 25});

        // receive 3d party own version of 2nd party
        newBft._addViewOfNodeWithPubKey(thirdPubKey, anotherPubKey, {data: 17});

        const value = newBft.runConsensus();
        assert.isNotOk(value);
    });

    it('should accept "non expose" witness message', async () => {
        const {arrKeyPairs, newBft} = createDummyBFT();
        const [keyPair1] = arrKeyPairs;

        const msg = new factory.Messages.MsgWitnessNextRound({groupId, roundNo: 12});

        msg.sign(keyPair1.privateKey);

        assert.isNotOk(newBft._views[keyPair1.publicKey][keyPair1.publicKey]);
        const wrapper = () => newBft.processMessage(msg);
        assert.doesNotThrow(wrapper);
        assert.isOk(newBft._views[keyPair1.publicKey][keyPair1.publicKey]);
        assert.equal(newBft._views[keyPair1.publicKey][keyPair1.publicKey].roundNo, msg.roundNo);
    });

    it('should accept "MsgExpose" witness message', async () => {
        const {arrKeyPairs, newWallet, newBft} = createDummyBFT();
        const [keyPair1, keyPair2] = arrKeyPairs;

        const msg = new factory.Messages.MsgWitnessNextRound({groupId, roundNo: 12});
        msg.sign(newWallet.privateKey);
        const msgExpose = new factory.Messages.MsgWitnessWitnessExpose(msg);
        msgExpose.sign(keyPair2.privateKey);

        assert.isNotOk(newBft._views[keyPair2.publicKey][keyPair1.publicKey]);
        const wrapper = () => newBft.processMessage(msgExpose);
        assert.doesNotThrow(wrapper);
        assert.isOk(newBft._views[keyPair2.publicKey][keyPair1.publicKey]);
        assert.equal(newBft._views[keyPair2.publicKey][keyPair1.publicKey].roundNo, msg.roundNo);
    });

    it('should reject message with bad signature', async function() {
        const keyPair3 = factory.Crypto.createKeyPair();
        const {newBft} = createDummyBFT();

        // wrong outer signature
        const msg = new factory.Messages.MsgWitnessNextRound({groupId, roundNo: 12});
        msg.sign(newBft._wallet.privateKey);
        const msgExpose = new factory.Messages.MsgWitnessWitnessExpose(msg);
        msgExpose.sign(keyPair3.privateKey);

        const wrapper = () => newBft.processMessage(msgExpose);
        assert.throws(wrapper);

        // wrong inner signature
        msg.sign(keyPair3.privateKey);
        const msgExpose2 = new factory.Messages.MsgWitnessWitnessExpose(msg);
        msgExpose2.sign(newBft._wallet.privateKey);

        const wrapper2 = () => newBft.processMessage(msgExpose2);
        assert.throws(wrapper2);

    });

    it('should reach consensus BUT NOT create block (hold off)', async () => {
        const {arrKeyPairs, newWallet, newBft} = createDummyBFT();
        const [, keyPair2] = arrKeyPairs;

        newBft.shouldPublish = sinon.fake.returns(true);

        // Message received from party
        const msgRoundParty = new factory.Messages.MsgWitnessNextRound({groupId, roundNo: 1});
        msgRoundParty.sign(keyPair2.privateKey);
        newBft.processMessage(msgRoundParty);

        // My message
        const msgRoundMy = new factory.Messages.MsgWitnessNextRound({groupId, roundNo: 1});
        msgRoundMy.sign(newWallet.privateKey);
        newBft.processMessage(msgRoundMy);

        // My message returned by party
        const msgMyExposed = new factory.Messages.MsgWitnessWitnessExpose(msgRoundMy);
        msgMyExposed.sign(keyPair2.privateKey);
        newBft.processMessage(msgMyExposed);

        // Party message exposed by me
        const msgPartyExposed = new factory.Messages.MsgWitnessWitnessExpose(msgRoundParty);
        msgPartyExposed.sign(newWallet.privateKey);
        newBft.processMessage(msgPartyExposed);

        assert.equal(newBft._state, factory.Constants.consensusStates.BLOCK);

    });

    it('should advance round', async () => {
        const {newBft} = createDummyBFT();

        const msgHandler = sinon.fake();
        newBft.on('message', msgHandler);
        newBft.processMessage = sinon.fake();

        newBft._nextRound();

        assert.isOk(msgHandler.calledOnce);
        const [msg] = msgHandler.args[0];
        assert.isOk(msg instanceof factory.Messages.MsgWitnessNextRound);

        assert.equal(newBft._state, factory.Constants.consensusStates.ROUND_CHANGE);
    });

    it('should start next round (remain in ROUND_CHANGE and adjust roundNo)', async () => {
        const {newBft} = createDummyBFT();

        newBft._state = factory.Constants.consensusStates.ROUND_CHANGE;
        newBft._nextRound = sinon.fake();

        const prevRound = newBft._roundNo = 123;

        newBft._roundChangeHandler(false);

        assert.isOk(newBft._nextRound.calledOnce);
        assert.equal(newBft._state, factory.Constants.consensusStates.ROUND_CHANGE);
        assert.notEqual(newBft._roundNo, prevRound);
    });

    it('should enter BLOCK state from ROUND_CHANGE', async () => {
        const {newBft} = createDummyBFT();
        const blockCreateHandler = sinon.fake();
        newBft.on('createBlock', blockCreateHandler);
        newBft._state = factory.Constants.consensusStates.ROUND_CHANGE;
        const msg = new factory.Messages.MsgWitnessNextRound({groupId, roundNo: 864});
        msg.encode();

        newBft._roundChangeHandler(true, {state: newBft._state, ...msg.content});

        assert.isNotOk(newBft._nextRound.calledOnce);
        assert.equal(newBft._state, factory.Constants.consensusStates.BLOCK);
        assert.equal(newBft._roundNo, 864);

        if (newBft.shouldPublish()) assert.isOk(blockCreateHandler.calledOnce);
    });

    it('should sync rounds and advance to BLOCK state', async () => {
        const {arrKeyPairs, newBft} = createDummyBFT();
        const [keyPair1, keyPair2] = arrKeyPairs;

        newBft._state = factory.Constants.consensusStates.ROUND_CHANGE;
        newBft._stateChange = sinon.fake();

        const createNextRoundMessage = (groupId, privateKey) => {
            const msg = new factory.Messages.MsgWitnessNextRound({groupId, roundNo: 864});
            msg.sign(privateKey);
            return msg;
        };

        // Message received from party
        const msgParty = createNextRoundMessage(groupId, keyPair2.privateKey);
        newBft.processMessage(msgParty);

        // My message
        const msgMy = createNextRoundMessage(groupId, keyPair1.privateKey);
        newBft.processMessage(msgMy);

        // My message returned by party
        const msgMyExposed = new factory.Messages.MsgWitnessWitnessExpose(msgMy);
        msgMyExposed.sign(keyPair2.privateKey);
        newBft.processMessage(msgMyExposed);

        // Party message exposed by me
        const msgPartyExposed = new factory.Messages.MsgWitnessWitnessExpose(msgParty);
        msgPartyExposed.sign(keyPair1.privateKey);
        newBft.processMessage(msgPartyExposed);

        assert.isOk(newBft._stateChange.calledOnce);
    });

    it('should REJECT block (all witnesses rejects it)', async () => {
        const {arrKeyPairs, newBft} = createDummyBFT();
        const [keyPair1, keyPair2] = arrKeyPairs;
        newBft._state = factory.Constants.consensusStates.BLOCK;
        newBft._nextRound = sinon.fake();

        const createBlockRejectMessage = (groupId, privateKey) => {
            const msg = factory.Messages.MsgWitnessBlockVote.reject(groupId);
            msg.sign(privateKey);
            return msg;
        };

        // Message received from party
        const msgParty = createBlockRejectMessage(groupId, keyPair2.privateKey);
        newBft.processMessage(msgParty);

        // My message
        const msgMy = createBlockRejectMessage(groupId, keyPair1.privateKey);
        newBft.processMessage(msgMy);

        // My message returned by party
        const msgMyExposed = new factory.Messages.MsgWitnessWitnessExpose(msgMy);
        msgMyExposed.sign(keyPair2.privateKey);
        newBft.processMessage(msgMyExposed);

        // Party message exposed by me
        const msgPartyExposed = new factory.Messages.MsgWitnessWitnessExpose(msgParty);
        msgPartyExposed.sign(keyPair1.privateKey);
        newBft.processMessage(msgPartyExposed);

        assert.isOk(newBft._nextRound.calledOnce);
    });

    it('should vote for a Block and advance state', async () => {
        const {arrKeyPairs, newBft} = createDummyBFT();
        const [keyPair1, keyPair2] = arrKeyPairs;

        newBft._state = factory.Constants.consensusStates.BLOCK;
        newBft._stateChange = sinon.fake();

        const fakeBlockHash = Buffer.from(factory.Crypto.randomBytes(32));
        const createBlockAckMessage = (groupId, privateKey) => {
            const msgBlockAck = new factory.Messages.MsgWitnessBlockVote({groupId, blockHash: fakeBlockHash});
            msgBlockAck.sign(privateKey);
            return msgBlockAck;
        };

        // Message received from party
        const msgParty = createBlockAckMessage(groupId, keyPair2.privateKey);
        newBft.processMessage(msgParty);

        // My message
        const msgMy = createBlockAckMessage(groupId, keyPair1.privateKey);
        newBft.processMessage(msgMy);

        // My message returned by party
        const msgMyExposed = new factory.Messages.MsgWitnessWitnessExpose(msgMy);
        msgMyExposed.sign(keyPair2.privateKey);
        newBft.processMessage(msgMyExposed);

        // Party message exposed by me
        const msgPartyExposed = new factory.Messages.MsgWitnessWitnessExpose(msgParty);
        msgPartyExposed.sign(keyPair1.privateKey);
        newBft.processMessage(msgPartyExposed);

        assert.isOk(newBft._stateChange.calledOnce);
    });

    it('should set state ROUND_CHANGE & clear block', async () => {
        const {newBft} = createDummyBFT();

        newBft._state = factory.Constants.consensusStates.BLOCK;
        newBft._block = {a: 1212};

        const msgHandler = sinon.fake();
        newBft.on('message', msgHandler);

        newBft._nextRound();

        assert.isNotOk(newBft._block);
        assert.equal(newBft._state, factory.Constants.consensusStates.ROUND_CHANGE);
        assert.isOk(msgHandler.calledOnce);
    });

    it('should store valid block and set own ACK for block', async () => {
        const {newBft} = createDummyBFT();

        newBft._state = factory.Constants.consensusStates.BLOCK;
        newBft._block = undefined;

        assert.isNotOk(newBft._views[newBft._wallet.publicKey][newBft._wallet.publicKey]);

        newBft.processValidBlock(createDummyBlock(factory), new factory.PatchDB());

        assert.isOk(newBft._block);
    });

    it('should move from ROUND_CHANGE to BLOCK state & create block', async () => {
        const {newBft} = createDummyBFT();
        newBft.shouldPublish = sinon.fake.returns(true);
        const blockCreateHandler = sinon.fake();
        newBft.on('createBlock', blockCreateHandler);

        newBft._stateChange(true, {
            state: factory.Constants.consensusStates.ROUND_CHANGE,
            data: Buffer.from([123])
        });

        assert.equal(newBft._state, factory.Constants.consensusStates.BLOCK);
        assert.isOk(blockCreateHandler.calledOnce);
    });

    it('should move from BLOCK to ROUND_CHANGE state because of timeout', async () => {
        const {newBft} = createDummyBFT();
        const msgHandler = sinon.fake();
        newBft.on('message', msgHandler);
        newBft.processMessage = sinon.fake();
        newBft._state = factory.Constants.consensusStates.BLOCK;

        newBft._stateChange(true);

        assert.equal(newBft._state, factory.Constants.consensusStates.ROUND_CHANGE);
        assert.isOk(msgHandler.calledOnce);
    });

    it('should advance from BLOCK to VOTE_BLOCK state', async () => {
        const {newBft} = createDummyBFT();
        newBft._state = factory.Constants.consensusStates.BLOCK;
        newBft._blockStateHandler(true);

        assert.equal(newBft._state, factory.Constants.consensusStates.VOTE_BLOCK);
    });

    it('should advance from VOTE_BLOCK to COMMIT state (block accepted)', async () => {
        const {newBft} = createDummyBFT();
        newBft._block = createDummyBlock(factory);
        newBft._getSignaturesForBlock = sinon.fake.returns([pseudoRandomBuffer(65), pseudoRandomBuffer(65)]);
        const blockCommitHandler = sinon.fake();
        newBft.on('commitBlock', blockCommitHandler);

        newBft._stateChange(true, {
            state: factory.Constants.consensusStates.VOTE_BLOCK,
            blockHash: Buffer.from(newBft._block.hash(), 'hex')
        });

        assert.equal(newBft._state, factory.Constants.consensusStates.COMMIT);
        assert.isOk(blockCommitHandler.calledOnce);
    });

    it('should advance from VOTE_BLOCK to COMMIT state but NO COMMIT (no block received)', async () => {
        const {newBft} = createDummyBFT();
        newBft._block = undefined;
        const blockCommitHandler = sinon.fake();
        newBft.on('commitBlock', blockCommitHandler);

        newBft._stateChange(true, {
            state: factory.Constants.consensusStates.VOTE_BLOCK,
            blockHash: pseudoRandomBuffer()
        });

        assert.equal(newBft._state, factory.Constants.consensusStates.COMMIT);
        assert.isNotOk(blockCommitHandler.calledOnce);
    });

    it('should advance from VOTE_BLOCK to COMMIT state but NO COMMIT (wrong block hash!)', async () => {
        const {newBft} = createDummyBFT();
        newBft._block = createDummyBlock(factory);

        const blockCommitHandler = sinon.fake();
        newBft.on('commitBlock', blockCommitHandler);

        newBft._stateChange(true, {
            state: factory.Constants.consensusStates.VOTE_BLOCK,
            blockHash: pseudoRandomBuffer()
        });

        assert.equal(newBft._state, factory.Constants.consensusStates.COMMIT);
        assert.isNotOk(blockCommitHandler.calledOnce);
    });

    it('should advance from VOTE_BLOCK to ROUND_CHANGE state (block rejected)', async () => {
        const {newBft} = createDummyBFT();
        const blockCommitHandler = sinon.fake();
        newBft.on('commitBlock', blockCommitHandler);
        const msgHandler = sinon.fake();
        newBft.on('message', msgHandler);

        newBft._stateChange(true, {
            state: factory.Constants.consensusStates.VOTE_BLOCK,
            blockHash: Buffer.from('reject')
        });

        assert.equal(newBft._state, factory.Constants.consensusStates.ROUND_CHANGE);
        assert.isNotOk(blockCommitHandler.calledOnce);
        assert.isOk(msgHandler.calledOnce);
    });

    it('should create ACCEPT vote message', async () => {
        const {newBft} = createDummyBFT();
        const blockHash = pseudoRandomBuffer();
        const msg = newBft._createBlockAcceptMessage(groupId, blockHash);
        assert.isOk(msg.isWitnessBlockVote());
        assert.isOk(blockHash.equals(msg.blockHash));
    });

    it('should create REJECT vote message', async () => {
        const {newBft} = createDummyBFT();
        const msg = newBft._createBlockRejectMessage(groupId);
        assert.isOk(msg.isWitnessBlockVote());
        assert.isOk(msg.blockHash.equals(Buffer.from('reject')));
    });

    it('should fail to get signatures (no block)', async () => {
        const {newBft} = createDummyBFT();
        assert.throws(() => newBft._getSignaturesForBlock());
    });

    it('should get signatures', async () => {
        const {arrKeyPairs, newBft, groupDefinition} = createDummyBFT(groupId, 2);
        const [myWalletPubKey, anotherPubKey] = groupDefinition.getPublicKeys();

        newBft._resetState();
        newBft._block = createDummyBlock(factory);
        const buffHash = Buffer.from(newBft._block.getHash(), 'hex');

        // my node put own version
        newBft._addViewOfNodeWithPubKey(
            arrKeyPairs[0].publicKey,
            arrKeyPairs[0].publicKey,
            {
                blockHash: buffHash,
                signature: factory.Crypto.sign(buffHash, arrKeyPairs[0].privateKey, 'hex')
            }
        );

        // my node got version of party
        newBft._addViewOfNodeWithPubKey(
            arrKeyPairs[0].publicKey,
            arrKeyPairs[1].publicKey,
            {
                blockHash: buffHash,
                signature: factory.Crypto.sign(buffHash, arrKeyPairs[1].privateKey, 'hex')
            }
        );

        // receive party view my version
        newBft._addViewOfNodeWithPubKey(
            arrKeyPairs[1].publicKey,
            arrKeyPairs[0].publicKey,
            {
                blockHash: buffHash,
                signature: factory.Crypto.sign(buffHash, arrKeyPairs[0].privateKey, 'hex')
            }
        );

        // receive party view of own version
        newBft._addViewOfNodeWithPubKey(
            arrKeyPairs[1].publicKey,
            arrKeyPairs[1].publicKey,
            {
                blockHash: buffHash,
                signature: factory.Crypto.sign(buffHash, arrKeyPairs[1].privateKey, 'hex')
            }
        );

        // move this state to "archive". _getSignaturesForBlock works with it
        newBft._resetState();

        const arrSignatures = newBft._getSignaturesForBlock();
        assert.isOk(arrSignatures);
        assert.equal(arrSignatures.length, 2);
    });

    it('should FAIL get signatures (bad quorum)', async () => {
        const {newBft} = createDummyBFT(groupId, 2);
        newBft._block = createDummyBlock(factory);

        newBft._groupDefinition.getQuorum = sinon.fake.returns(0);

        try {
            newBft._getSignaturesForBlock();
        } catch (e) {
            return;
        }
        throw new Error('Unexpected success');
    });

    it('should FAIL get signatures no votes', async () => {
        const {newBft} = createDummyBFT(groupId, 2);
        newBft._resetState();
        newBft._block = createDummyBlock(factory);

        const result = newBft._getSignaturesForBlock();
        assert.isNotOk(result);
    });

});
