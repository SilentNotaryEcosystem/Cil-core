const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');

const {sleep} = require('../utils');

factory = require('./testFactory');

let myWallet;
const groupName = 'test';
let BFT;

const createDummyBFT = (groupName) => {
    const keyPair1 = factory.Crypto.createKeyPair();
    const keyPair2 = factory.Crypto.createKeyPair();
    const newWallet = new factory.Wallet(keyPair1.privateKey);
    const newBft = new factory.BFT({
        groupName,
        arrPublicKeys: [keyPair1.publicKey, keyPair2.publicKey],
        wallet: newWallet
    });
    newBft._stopTimer();

    return {keyPair1, keyPair2, newBft, newWallet};
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

    it('should PASS (one witness)', async () => {
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [myWallet.publicKey],
            wallet: myWallet
        });
        const sampleData = {data: 1};
        newBft._resetState();
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, myWallet.publicKey, sampleData);
        const value = newBft.runConsensus();
        assert.deepEqual(sampleData, value);
    });

    it('should PASS (two witness same data)', async () => {
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey'],
            wallet: myWallet
        });
        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, myWallet.publicKey, sampleData);

        // my node got version of party
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'anotherPubKey', sampleData);

        // receive party view my version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', myWallet.publicKey, sampleData);

        // receive party view of own version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'anotherPubKey', sampleData);
        const value = newBft.runConsensus();
        assert.deepEqual(sampleData, value);
    });

    it('should PASS (two witness same data - BUFFER)', async () => {
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey'],
            wallet: myWallet
        });
        const sampleData = Buffer.from('1234');
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, myWallet.publicKey, sampleData);

        // my node got version of party
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'anotherPubKey', sampleData);

        // receive party view my version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', myWallet.publicKey, sampleData);

        // receive party view of own version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'anotherPubKey', sampleData);
        const value = newBft.runConsensus();
        assert.deepEqual(sampleData, value);
    });

    it('should FAIL (two witness different data)', async () => {
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey'],
            wallet: myWallet
        });
        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, myWallet.publicKey, sampleData);

        // my node got version of party
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'anotherPubKey', undefined);

        // receive party view my version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', myWallet.publicKey, sampleData);

        // receive party view of own version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'anotherPubKey', undefined);
        const value = newBft.runConsensus();
        assert.isNotOk(value);
    });

    it('should FAIL (two witness party tries to forge my data)', async () => {
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey'],
            wallet: myWallet
        });
        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, myWallet.publicKey, sampleData);

        // my node got version of party
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'anotherPubKey', sampleData);

        // receive party view my version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', myWallet.publicKey, undefined);

        // receive party view of own version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'anotherPubKey', sampleData);
        const value = newBft.runConsensus();
        assert.isNotOk(value);
    });

    it('should PASS 3 witness same data', async () => {
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey', 'thirdPubKey'],
            wallet: myWallet
        });
        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, myWallet.publicKey, sampleData);

        // my node got version of 2nd party
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'anotherPubKey', sampleData);

        // my node got version of 3d party
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'thirdPubKey', sampleData);

        // receive 2nd party view my version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', myWallet.publicKey, sampleData);

        // receive 2nd party view of own version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'anotherPubKey', sampleData);

        // receive from 2nd party version of 3d party
        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'thirdPubKey', sampleData);

        // receive 3d party view my version
        newBft._addViewOfNodeWithPubKey('thirdPubKey', myWallet.publicKey, sampleData);

        // receive 3d party own version
        newBft._addViewOfNodeWithPubKey('thirdPubKey', 'thirdPubKey', sampleData);

        // receive 3d party own version of 2nd party
        newBft._addViewOfNodeWithPubKey('thirdPubKey', 'anotherPubKey', sampleData);

        const value = newBft.runConsensus();
        assert.deepEqual(value, sampleData);
    });

    it('should PASS 3 witness (one dead)', async () => {
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey', 'thirdPubKey'],
            wallet: myWallet
        });
        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, myWallet.publicKey, sampleData);

        // my node got version of 2nd party
//        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'anotherPubKey', undefined);

        // my node got version of 3d party
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'thirdPubKey', sampleData);

        // receive 2nd party view my version
//        newBft._addViewOfNodeWithPubKey('anotherPubKey', myWallet.publicKey, undefined);

        // receive 2nd party view of own version
//        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'anotherPubKey', undefined);

        // receive from 2nd party version of 3d party
//        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'thirdPubKey', undefined);

        // receive 3d party view my version
        newBft._addViewOfNodeWithPubKey('thirdPubKey', myWallet.publicKey, sampleData);

        // receive 3d party own version
        newBft._addViewOfNodeWithPubKey('thirdPubKey', 'thirdPubKey', sampleData);

        // receive 3d party own version of 2nd party
//        newBft._addViewOfNodeWithPubKey('thirdPubKey', 'anotherPubKey', undefined);

        const value = newBft.runConsensus();
        assert.deepEqual(value, sampleData);
    });

    it('should PASS 3 witness (one tries to misbehave)', async () => {
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey', 'thirdPubKey'],
            wallet: myWallet
        });
        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, myWallet.publicKey, sampleData);

        // my node got version of 2nd party
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'anotherPubKey', {data: 13});

        // my node got version of 3d party
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'thirdPubKey', sampleData);

        // receive 2nd party view my version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', myWallet.publicKey, {data: 14});

        // receive 2nd party view of own version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'anotherPubKey', {data: 15});

        // receive from 2nd party version of 3d party
        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'thirdPubKey', {data: 16});

        // receive 3d party view my version
        newBft._addViewOfNodeWithPubKey('thirdPubKey', myWallet.publicKey, sampleData);

        // receive 3d party own version
        newBft._addViewOfNodeWithPubKey('thirdPubKey', 'thirdPubKey', sampleData);

        // receive 3d party own version of 2nd party
        newBft._addViewOfNodeWithPubKey('thirdPubKey', 'anotherPubKey', {data: 17});

        const value = newBft.runConsensus();
        assert.deepEqual(value, sampleData);
    });

    it('should PASS 3 witness (MY data is wrong)', async () => {
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey', 'thirdPubKey'],
            wallet: myWallet
        });
        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, myWallet.publicKey, {data: 11});

        // my node got version of 2nd party
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'anotherPubKey', sampleData);

        // my node got version of 3d party
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'thirdPubKey', sampleData);

        // receive 2nd party view my version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', myWallet.publicKey, {data: 11});

        // receive 2nd party view of own version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'anotherPubKey', sampleData);

        // receive from 2nd party version of 3d party
        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'thirdPubKey', sampleData);

        // receive 3d party view my version
        newBft._addViewOfNodeWithPubKey('thirdPubKey', myWallet.publicKey, {data: 11});

        // receive 3d party own version
        newBft._addViewOfNodeWithPubKey('thirdPubKey', 'thirdPubKey', sampleData);

        // receive 3d party own version of 2nd party
        newBft._addViewOfNodeWithPubKey('thirdPubKey', 'anotherPubKey', sampleData);

        const value = newBft.runConsensus();
        assert.deepEqual(value, sampleData);
    });

    it('should FAIL 3 witness (two tries to misbehave)', async () => {
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey', 'thirdPubKey'],
            wallet: myWallet
        });
        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, myWallet.publicKey, sampleData);

        // my node got version of 2nd party
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'anotherPubKey', {data: 13});

        // my node got version of 3d party
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'thirdPubKey', {data: 23});

        // receive 2nd party view my version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', myWallet.publicKey, {data: 14});

        // receive 2nd party view of own version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'anotherPubKey', {data: 15});

        // receive from 2nd party version of 3d party
        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'thirdPubKey', {data: 16});

        // receive 3d party view my version
        newBft._addViewOfNodeWithPubKey('thirdPubKey', myWallet.publicKey, {data: 24});

        // receive 3d party own version
        newBft._addViewOfNodeWithPubKey('thirdPubKey', 'thirdPubKey', {data: 25});

        // receive 3d party own version of 2nd party
        newBft._addViewOfNodeWithPubKey('thirdPubKey', 'anotherPubKey', {data: 17});

        const value = newBft.runConsensus();
        assert.isNotOk(value);
    });

    it('should accept "non expose" witness message', async () => {
        const {keyPair1, keyPair2, newBft, newWallet} = createDummyBFT(groupName);


        const msg = new factory.Messages.MsgWitnessNextRound({groupName, roundNo: 12});
        msg.sign(keyPair1.privateKey);

        assert.isNotOk(newBft._views[keyPair1.publicKey][keyPair1.publicKey]);
        const wrapper = () => newBft.processMessage(msg);
        assert.doesNotThrow(wrapper);
        assert.isOk(newBft._views[keyPair1.publicKey][keyPair1.publicKey]);
        assert.equal(newBft._views[keyPair1.publicKey][keyPair1.publicKey].data, msg.content);
    });

    it('should accept "MsgExpose" witness message', async () => {
        const {keyPair1, keyPair2, newBft, newWallet} = createDummyBFT(groupName);


        const msg = new factory.Messages.MsgWitnessNextRound({groupName, roundNo: 12});
        msg.sign(newWallet.privateKey);
        const msgExpose = new factory.Messages.MsgWitnessWitnessExpose(msg);
        msgExpose.sign(keyPair2.privateKey);

        assert.isNotOk(newBft._views[keyPair2.publicKey][keyPair1.publicKey]);
        const wrapper = () => newBft.processMessage(msgExpose);
        assert.doesNotThrow(wrapper);
        assert.isOk(newBft._views[keyPair2.publicKey][keyPair1.publicKey]);
        assert.equal(newBft._views[keyPair2.publicKey][keyPair1.publicKey].data + '', msg.content + '');
    });

    it('should reject message with bad signature', async function() {
        const keyPair3 = factory.Crypto.createKeyPair();
        const {newBft} = createDummyBFT(groupName);


        // wrong outer signature
        const msg = new factory.Messages.MsgWitnessNextRound({groupName, roundNo: 12});
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

    it('should reach consensus and create block', async () => {
        const {keyPair1, keyPair2, newBft, newWallet} = createDummyBFT(groupName);

        newBft.shouldPublish = sinon.fake.returns(true);

        const eventHandler = sinon.fake();
        newBft.on('createBlock', eventHandler);

        // Message received from party
        const msgRoundParty = new factory.Messages.MsgWitnessNextRound({groupName, roundNo: 1});
        msgRoundParty.sign(keyPair2.privateKey);
        newBft.processMessage(msgRoundParty);

        // My message
        const msgRoundMy = new factory.Messages.MsgWitnessNextRound({groupName, roundNo: 1});
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

        assert.isOk(eventHandler.calledOnce);
        assert.equal(newBft._state, factory.Constants.consensusStates.BLOCK);

    });

    it('should advance round', async () => {
        const {newBft} = createDummyBFT(groupName);


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
        const {newBft} = createDummyBFT(groupName);

        newBft._state = factory.Constants.consensusStates.ROUND_CHANGE;
        newBft._nextRound = sinon.fake();

        const prevRound = newBft._roundNo = 123;

        newBft._roundChangeHandler(false);

        assert.isOk(newBft._nextRound.calledOnce);
        assert.equal(newBft._state, factory.Constants.consensusStates.ROUND_CHANGE);
        assert.notEqual(newBft._roundNo, prevRound);
    });

    it('should enter BLOCK state from ROUND_CHANGE', async () => {
        const {newBft} = createDummyBFT(groupName);
        const blockCreateHandler = sinon.fake();
        newBft.on('createBlock', blockCreateHandler);
        newBft._state = factory.Constants.consensusStates.ROUND_CHANGE;
        const msg = new factory.Messages.MsgWitnessNextRound({groupName, roundNo: 864});
        msg.encode();

        newBft._roundChangeHandler(true, {state: newBft._state, data: msg.content});

        assert.isNotOk(newBft._nextRound.calledOnce);
        assert.equal(newBft._state, factory.Constants.consensusStates.BLOCK);
        assert.equal(newBft._roundNo, 864);

        if (newBft.shouldPublish()) assert.isOk(blockCreateHandler.calledOnce);
    });

    it('should vote for a Block and advance state', async () => {
        const {keyPair1, keyPair2, newBft, newWallet} = createDummyBFT(groupName);

        newBft._state = factory.Constants.consensusStates.BLOCK;
        newBft._stateChange = sinon.fake();

        const fakeBlockHash = factory.Crypto.createHash(factory.Crypto.randomBytes(16));
        const createBlockAckMessage = (groupName, privateKey) => {
            const msgBlockAck = new factory.Messages.MsgWitnessCommon({groupName});
            msgBlockAck.blockAcceptMessage = fakeBlockHash;
            msgBlockAck.sign(privateKey);
            return msgBlockAck;
        };

        // Message received from party
        const msgParty = createBlockAckMessage(groupName, keyPair2.privateKey);
        newBft.processMessage(msgParty);

        // My message
        const msgMy = createBlockAckMessage(groupName, keyPair1.privateKey);
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
        const {newBft} = createDummyBFT(groupName);

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
        const {newBft} = createDummyBFT(groupName);

        newBft._state = factory.Constants.consensusStates.BLOCK;
        newBft._block = undefined;

        assert.isNotOk(newBft._views[newBft._wallet.publicKey][newBft._wallet.publicKey]);

        newBft.processValidBlock(new factory.Block());

        assert.isOk(newBft._block);
    });

    it('should move from ROUND_CHANGE to BLOCK state & create block', async () => {
        const {newBft} = createDummyBFT(groupName);
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
        const {newBft} = createDummyBFT(groupName);
        const msgHandler = sinon.fake();
        newBft.on('message', msgHandler);
        newBft.processMessage = sinon.fake();
        newBft._state = factory.Constants.consensusStates.BLOCK;

        newBft._stateChange(true);

        assert.equal(newBft._state, factory.Constants.consensusStates.ROUND_CHANGE);
        assert.isOk(msgHandler.calledOnce);
    });

    it('should advance from BLOCK to VOTE_BLOCK state', async () => {
        const {newBft} = createDummyBFT(groupName);
        newBft._state = factory.Constants.consensusStates.BLOCK;
        newBft._blockStateHandler(true);

        assert.equal(newBft._state, factory.Constants.consensusStates.VOTE_BLOCK);
    });

    it('should advance from VOTE_BLOCK to COMMIT state (block accepted)', async () => {
        const {newBft} = createDummyBFT(groupName);
        newBft._block = new factory.Block();
        const blockCommitHandler = sinon.fake();
        newBft.on('commitBlock', blockCommitHandler);

        newBft._stateChange(true, {
            state: factory.Constants.consensusStates.VOTE_BLOCK,
            data: newBft._block.hash()
        });

        assert.equal(newBft._state, factory.Constants.consensusStates.COMMIT);
        assert.isOk(blockCommitHandler.calledOnce);
    });

    it('should advance from VOTE_BLOCK to COMMIT state but NO COMMIT (no block received)', async () => {
        const {newBft} = createDummyBFT(groupName);
        newBft._block = undefined;
        const blockCommitHandler = sinon.fake();
        newBft.on('commitBlock', blockCommitHandler);

        newBft._stateChange(true, {
            state: factory.Constants.consensusStates.VOTE_BLOCK,
            data: '123'
        });

        assert.equal(newBft._state, factory.Constants.consensusStates.COMMIT);
        assert.isNotOk(blockCommitHandler.calledOnce);
    });

    it('should advance from VOTE_BLOCK to COMMIT state but NO COMMIT (wrong hash!)', async () => {
        const {newBft} = createDummyBFT(groupName);
        newBft._block = new factory.Block();

        const blockCommitHandler = sinon.fake();
        newBft.on('commitBlock', blockCommitHandler);

        newBft._stateChange(true, {
            state: factory.Constants.consensusStates.VOTE_BLOCK,
            data: '123'
        });

        assert.equal(newBft._state, factory.Constants.consensusStates.COMMIT);
        assert.isNotOk(blockCommitHandler.calledOnce);
    });

    it('should advance from VOTE_BLOCK to ROUND_CHANGE state (block rejected)', async () => {
        const {newBft} = createDummyBFT(groupName);
        const blockCommitHandler = sinon.fake();
        newBft.on('commitBlock', blockCommitHandler);
        const msgHandler = sinon.fake();
        newBft.on('message', msgHandler);

        newBft._stateChange(true, {
            state: factory.Constants.consensusStates.VOTE_BLOCK,
            data: 'reject'
        });

        assert.equal(newBft._state, factory.Constants.consensusStates.ROUND_CHANGE);
        assert.isNotOk(blockCommitHandler.calledOnce);
        assert.isOk(msgHandler.calledOnce);
    });

});
