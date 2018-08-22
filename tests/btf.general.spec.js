const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');

const {sleep} = require('../utils');

factory = require('./testFactory');

let myWallet;
const groupName = 'test';
let BFT;

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

        // 2 witness in group
        const keyPair1 = factory.Crypto.createKeyPair();
        const keyPair2 = factory.Crypto.createKeyPair();

        const wallet = new factory.Wallet(keyPair1.privateKey);
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [wallet.publicKey, keyPair2.publicKey],
            wallet: wallet
        });

        const msg = new factory.Messages.MsgWitnessNextRound({groupName, roundNo: 12});
        msg.sign(keyPair1.privateKey);

        assert.isNotOk(newBft._views[keyPair1.publicKey][keyPair1.publicKey]);
        const wrapper = () => newBft.processMessage(msg);
        assert.doesNotThrow(wrapper);
        assert.isOk(newBft._views[keyPair1.publicKey][keyPair1.publicKey]);
        assert.equal(newBft._views[keyPair1.publicKey][keyPair1.publicKey], msg.content);
    });

    it('should accept "MsgExpose" witness message', async () => {

        // 2 witness in group
        const keyPair1 = factory.Crypto.createKeyPair();
        const keyPair2 = factory.Crypto.createKeyPair();

        const wallet = new factory.Wallet(keyPair1.privateKey);
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [wallet.publicKey, keyPair2.publicKey],
            wallet: wallet
        });

        const msg = new factory.Messages.MsgWitnessNextRound({groupName, roundNo: 12});
        msg.sign(keyPair1.privateKey);
        const msgExpose = new factory.Messages.MsgWitnessWitnessExpose(msg);
        msgExpose.sign(keyPair2.privateKey);

        assert.isNotOk(newBft._views[keyPair2.publicKey][keyPair1.publicKey]);
        const wrapper = () => newBft.processMessage(msgExpose);
        assert.doesNotThrow(wrapper);
        assert.isOk(newBft._views[keyPair2.publicKey][keyPair1.publicKey]);
        assert.equal(newBft._views[keyPair2.publicKey][keyPair1.publicKey] + '', msg.content + '');
    });

    it('should reject message with bad signature', async function() {

        // 2 witness in group
        const keyPair1 = factory.Crypto.createKeyPair();
        const keyPair2 = factory.Crypto.createKeyPair();
        const keyPair3 = factory.Crypto.createKeyPair();

        const wallet = new factory.Wallet(keyPair1.privateKey);
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [wallet.publicKey, keyPair2.publicKey],
            wallet: wallet
        });

        // wrong outer signature
        const msg = new factory.Messages.MsgWitnessNextRound({groupName, roundNo: 12});
        msg.sign(keyPair1.privateKey);
        const msgExpose = new factory.Messages.MsgWitnessWitnessExpose(msg);
        msgExpose.sign(keyPair3.privateKey);

        const wrapper = () => newBft.processMessage(msgExpose);
        assert.throws(wrapper);

        // wrong inner signature
        msg.sign(keyPair3.privateKey);
        const msgExpose2 = new factory.Messages.MsgWitnessWitnessExpose(msg);
        msgExpose2.sign(keyPair2.privateKey);

        const wrapper2 = () => newBft.processMessage(msgExpose2);
        assert.throws(wrapper2);

    });

    it('should reach consensus', async () => {
        // 2 witness in group
        const keyPair1 = factory.Crypto.createKeyPair();
        const keyPair2 = factory.Crypto.createKeyPair();

        const wallet = new factory.Wallet(keyPair1.privateKey);
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [keyPair1.publicKey, keyPair2.publicKey],
            wallet
        });

        // not emit anything yet
        const messageHandler = sinon.fake();
        newBft.on('message', messageHandler);

        // Message received from party
        const msgRoundParty = new factory.Messages.MsgWitnessNextRound({groupName, roundNo: 1});
        msgRoundParty.sign(keyPair2.privateKey);
        newBft.processMessage(msgRoundParty);

        // My message
        const msgRoundMy = new factory.Messages.MsgWitnessNextRound({groupName, roundNo: 1});
        msgRoundMy.sign(wallet.privateKey);
        newBft.processMessage(msgRoundMy);

        // My message returned by party
        const msgMyExposed = new factory.Messages.MsgWitnessWitnessExpose(msgRoundMy);
        msgMyExposed.sign(keyPair2.privateKey);
        newBft.processMessage(msgMyExposed);

        // Party message exposed by me
        const msgPartyExposed = new factory.Messages.MsgWitnessWitnessExpose(msgRoundParty);
        msgPartyExposed.sign(wallet.privateKey);
        newBft.processMessage(msgPartyExposed);

        // not emit anything yet
//        assert.isOk(messageHandler.calledOnce);
//        const [msg] = messageHandler.args[0];
//        assert.isOk(msg.isNextRound());
//        assert.equal(msg.roundNo, 1);

        assert.equal(newBft._state, factory.Constants.consensusStates.BLOCK);

    });

//    it('should fail to join consensus (standalone witness) and start broadcast messages', async function() {
//        this.timeout(5000);
//
//        // 3 witness in group
//        const keyPair1 = factory.Crypto.createKeyPair();
//        const keyPair2 = factory.Crypto.createKeyPair();
//        const keyPair3 = factory.Crypto.createKeyPair();
//
//        const wallet = new factory.Wallet(keyPair1.privateKey);
//        const newBft = new BFT({
//            groupName,
//            arrPublicKeys: [keyPair1.publicKey, keyPair2.publicKey, keyPair3.publicKey],
//            wallet
//        });
//
//        const messageHandler = sinon.fake();
//        newBft.on('message', messageHandler);
//
//        await sleep(factory.Constants.consensusTimeouts.INIT + 100);
//        assert.isOk(messageHandler.calledOnce);
//
//        const [msg] = messageHandler.args[0];
//        assert.isOk(msg.isNextRound());
//        assert.equal(msg.roundNo, 1);
//
//        assert.equal(newBft._state, factory.Constants.consensusStates.ROUND_CHANGE);
//    });

    it('should advance round from INIT', async () => {
        const keyPair1 = factory.Crypto.createKeyPair();
        const keyPair2 = factory.Crypto.createKeyPair();
        const wallet = new factory.Wallet(keyPair1.privateKey);
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [keyPair1.publicKey, keyPair2.publicKey],
            wallet
        });
        newBft._stopTimer();

        const msgHandler = sinon.fake();
        newBft.on('message', msgHandler);
        newBft.processMessage = sinon.fake();

        newBft._nextRound();

        assert.isOk(msgHandler.calledOnce);
        const [msg] = msgHandler.args[0];
        assert.isOk(msg instanceof factory.Messages.MsgWitnessNextRound);

        assert.isOk(newBft.processMessage.calledOnce);

        assert.equal(newBft._state, factory.Constants.consensusStates.ROUND_CHANGE);
    });

    it('should enter ROUND_CHANGE state from INIT', async () => {
        const keyPair1 = factory.Crypto.createKeyPair();
        const keyPair2 = factory.Crypto.createKeyPair();
        const wallet = new factory.Wallet(keyPair1.privateKey);
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [keyPair1.publicKey, keyPair2.publicKey],
            wallet
        });
        newBft._stopTimer();
        newBft._nextRound = sinon.fake();

        newBft._initStateHandler(false);

        assert.isOk(newBft._nextRound.calledOnce);
    });

    it('should enter BLOCK state from INIT', async () => {
        const keyPair1 = factory.Crypto.createKeyPair();
        const keyPair2 = factory.Crypto.createKeyPair();
        const wallet = new factory.Wallet(keyPair1.privateKey);
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [keyPair1.publicKey, keyPair2.publicKey],
            wallet
        });
        newBft._stopTimer();
        newBft._nextRound = sinon.fake();

        const msg = new factory.Messages.MsgWitnessNextRound({groupName, roundNo: 863});
        msg.encode();

        newBft._initStateHandler(true, msg.content);

        assert.isNotOk(newBft._nextRound.calledOnce);
        assert.equal(newBft._state, factory.Constants.consensusStates.BLOCK);
        assert.equal(newBft._roundNo, 863);
    });

    it('should start next round (remain in ROUND_CHANGE and adjust roundNo)', async () => {
        const keyPair1 = factory.Crypto.createKeyPair();
        const keyPair2 = factory.Crypto.createKeyPair();
        const wallet = new factory.Wallet(keyPair1.privateKey);
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [keyPair1.publicKey, keyPair2.publicKey],
            wallet
        });
        newBft._stopTimer();
        newBft._state = factory.Constants.consensusStates.ROUND_CHANGE;
        newBft._nextRound = sinon.fake();

        const prevRound = newBft._roundNo = 123;

        newBft._roundChangeHandler(false);

        assert.isOk(newBft._nextRound.calledOnce);
        assert.equal(newBft._state, factory.Constants.consensusStates.ROUND_CHANGE);
        assert.notEqual(newBft._roundNo, prevRound);
    });

    it('should enter BLOCK state from ROUND_CHANGE', async () => {
        const keyPair1 = factory.Crypto.createKeyPair();
        const keyPair2 = factory.Crypto.createKeyPair();
        const wallet = new factory.Wallet(keyPair1.privateKey);
        const newBft = new BFT({
            groupName,
            arrPublicKeys: [keyPair1.publicKey, keyPair2.publicKey],
            wallet
        });
        newBft._stopTimer();
        newBft._state = factory.Constants.consensusStates.ROUND_CHANGE;
        const msg = new factory.Messages.MsgWitnessNextRound({groupName, roundNo: 863});
        msg.encode();

        newBft._roundChangeHandler(true, msg.content);

        assert.isNotOk(newBft._nextRound.calledOnce);
        assert.equal(newBft._state, factory.Constants.consensusStates.BLOCK);
        assert.equal(newBft._roundNo, 863);
    });

});
