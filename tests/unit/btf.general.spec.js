const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');

const {pseudoRandomBuffer, createDummyBlock} = require('../testUtil');

const factory = require('../testFactory');

// let myWallet;
const conciliumId = 0;
// let BFT;

const createDummyBFT = (conciliumId = 0, numOfKeys = 2) => {
    const arrKeyPairs = [];
    const arrAddresses = [];
    for (let i = 0; i < numOfKeys; i++) {
        const keyPair = factory.Crypto.createKeyPair();
        arrKeyPairs.push(keyPair);
        arrAddresses.push(keyPair.address);
    }
    const newWallet = new factory.Wallet(arrKeyPairs[0].privateKey);

    const concilium = factory.ConciliumRr.create(conciliumId, arrAddresses);

    const newBft = new factory.BFT({
        concilium,
        wallet: newWallet
    });
    newBft._stopTimer();

    return {arrKeyPairs, newWallet, concilium, newBft};
};

describe('BFT general tests', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
        // BFT = factory.BFT;

        // const keyPair = factory.Crypto.createKeyPair();
        // myWallet = new factory.Wallet(keyPair.privateKey);
    });

    after(async function () {
        this.timeout(15000);
    });

    it('should get MAJORITY for SOLO witness (concilium of 2 delegates, but with quorum 1)', async () => {
        const kp1 = factory.Crypto.createKeyPair();
        const kp2 = factory.Crypto.createKeyPair();
        const newWallet = new factory.Wallet(kp1.privateKey);

        const concilium = factory.ConciliumRr.create(conciliumId, [kp1.address, kp2.address], 1);

        const newBft = new factory.BFT({
            concilium,
            wallet: newWallet
        });
        newBft._stopTimer();
        assert.equal(newBft._majority([1, 0]), 1);
        assert.equal(newBft._majority([undefined, 0]), 0);
        assert.equal(newBft._majority([0, undefined]), 0);
    });

    it('should get default MAJORITY (concilium of 2 delegates, with quorum 2)', async () => {
        const kp1 = factory.Crypto.createKeyPair();
        const kp2 = factory.Crypto.createKeyPair();
        const newWallet = new factory.Wallet(kp1.privateKey);

        const concilium = factory.ConciliumRr.create(conciliumId, [kp1.address, kp2.address], undefined);

        const newBft = new factory.BFT({
            concilium,
            wallet: newWallet
        });
        newBft._stopTimer();
        assert.equal(newBft._majority([1, 0]), undefined);
        assert.equal(newBft._majority([undefined, undefined]), undefined);
        assert.equal(newBft._majority([1, 1]), 1);
        assert.equal(newBft._majority([0, 0]), 0);
    });

    it('should PASS (one witness)', async () => {
        const {newBft, concilium} = createDummyBFT(conciliumId, 1);
        const sampleData = {data: 1};
        const [myWalletAddress] = concilium.getAddresses();
        newBft._resetState();
        newBft._addViewOfNodeWithAddr(myWalletAddress, myWalletAddress, sampleData);
        const value = newBft.runConsensus();
        assert.deepEqual(sampleData, value);
    });

    it('should PASS (two witness same data)', async () => {
        const {newBft, concilium} = createDummyBFT(conciliumId, 2);
        const [myWalletAddress, anotherAddress] = concilium.getAddresses();
        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithAddr(myWalletAddress, myWalletAddress, sampleData);

        // my node got version of party
        newBft._addViewOfNodeWithAddr(myWalletAddress, anotherAddress, sampleData);

        // receive party view my version
        newBft._addViewOfNodeWithAddr(anotherAddress, myWalletAddress, sampleData);

        // receive party view of own version
        newBft._addViewOfNodeWithAddr(anotherAddress, anotherAddress, sampleData);
        const value = newBft.runConsensus();
        assert.deepEqual(sampleData, value);
    });

    it('should PASS (two witness same data - BUFFER)', async () => {
        const {newBft, concilium} = createDummyBFT(conciliumId, 2);
        const [myWalletAddress, anotherAddress] = concilium.getAddresses();

        const sampleData = Buffer.from('1234');
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithAddr(myWalletAddress, myWalletAddress, sampleData);

        // my node got version of party
        newBft._addViewOfNodeWithAddr(myWalletAddress, anotherAddress, sampleData);

        // receive party view my version
        newBft._addViewOfNodeWithAddr(anotherAddress, myWalletAddress, sampleData);

        // receive party view of own version
        newBft._addViewOfNodeWithAddr(anotherAddress, anotherAddress, sampleData);
        const value = newBft.runConsensus();
        assert.deepEqual(sampleData, value);
    });

    it('should FAIL (two witness different data)', async () => {
        const {newBft, concilium} = createDummyBFT(conciliumId, 2);
        const [myWalletAddress, anotherAddress] = concilium.getAddresses();

        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithAddr(myWalletAddress, myWalletAddress, sampleData);

        // my node got version of party
        newBft._addViewOfNodeWithAddr(myWalletAddress, anotherAddress, undefined);

        // receive party view my version
        newBft._addViewOfNodeWithAddr(anotherAddress, myWalletAddress, sampleData);

        // receive party view of own version
        newBft._addViewOfNodeWithAddr(anotherAddress, anotherAddress, undefined);
        const value = newBft.runConsensus();
        assert.isNotOk(value);
    });

    it('should FAIL (two witness party tries to forge my data)', async () => {
        const {newBft, concilium} = createDummyBFT(conciliumId, 2);
        const [myWalletAddress, anotherAddress] = concilium.getAddresses();

        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithAddr(myWalletAddress, myWalletAddress, sampleData);

        // my node got version of party
        newBft._addViewOfNodeWithAddr(myWalletAddress, anotherAddress, sampleData);

        // receive party view my version
        newBft._addViewOfNodeWithAddr(anotherAddress, myWalletAddress, undefined);

        // receive party view of own version
        newBft._addViewOfNodeWithAddr(anotherAddress, anotherAddress, sampleData);
        const value = newBft.runConsensus();
        assert.isNotOk(value);
    });

    it('should PASS 3 witness same data', async () => {
        const {newBft, concilium} = createDummyBFT(0, 3);
        const [myWalletAddress, anotherAddress, thirdAddress] = concilium.getAddresses();

        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithAddr(myWalletAddress, myWalletAddress, sampleData);

        // my node got version of 2nd party
        newBft._addViewOfNodeWithAddr(myWalletAddress, anotherAddress, sampleData);

        // my node got version of 3d party
        newBft._addViewOfNodeWithAddr(myWalletAddress, 'thirdAddress', sampleData);

        // receive 2nd party view my version
        newBft._addViewOfNodeWithAddr(anotherAddress, myWalletAddress, sampleData);

        // receive 2nd party view of own version
        newBft._addViewOfNodeWithAddr(anotherAddress, anotherAddress, sampleData);

        // receive from 2nd party version of 3d party
        newBft._addViewOfNodeWithAddr(anotherAddress, thirdAddress, sampleData);

        // receive 3d party view my version
        newBft._addViewOfNodeWithAddr(thirdAddress, myWalletAddress, sampleData);

        // receive 3d party own version
        newBft._addViewOfNodeWithAddr(thirdAddress, thirdAddress, sampleData);

        // receive 3d party own version of 2nd party
        newBft._addViewOfNodeWithAddr(thirdAddress, anotherAddress, sampleData);

        const value = newBft.runConsensus();
        assert.deepEqual(value, sampleData);
    });

    it('should PASS 3 witness (one dead)', async () => {
        const {newBft, concilium} = createDummyBFT(0, 3);
        const [myWalletAddress, /*anotherAddress,*/ thirdAddress] = concilium.getAddresses();

        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithAddr(myWalletAddress, myWalletAddress, sampleData);

        // my node got version of 2nd party
        //        newBft._addViewOfNodeWithAddr(myWalletAddress, anotherAddress, undefined);

        // my node got version of 3d party
        newBft._addViewOfNodeWithAddr(myWalletAddress, thirdAddress, sampleData);

        // receive 2nd party view my version
        //        newBft._addViewOfNodeWithAddr(anotherAddress, myWalletAddress, undefined);

        // receive 2nd party view of own version
        //        newBft._addViewOfNodeWithAddr(anotherAddress, anotherAddress, undefined);

        // receive from 2nd party version of 3d party
        //        newBft._addViewOfNodeWithAddr(anotherAddress, thirdAddress, undefined);

        // receive 3d party view my version
        newBft._addViewOfNodeWithAddr(thirdAddress, myWalletAddress, sampleData);

        // receive 3d party own version
        newBft._addViewOfNodeWithAddr(thirdAddress, thirdAddress, sampleData);

        // receive 3d party own version of 2nd party
        //        newBft._addViewOfNodeWithAddr(thirdAddress, anotherAddress, undefined);

        const value = newBft.runConsensus();
        assert.deepEqual(value, sampleData);
    });

    it('should PASS 3 witness (one tries to misbehave)', async () => {
        const {newBft, concilium} = createDummyBFT(0, 3);
        const [myWalletAddress, anotherAddress, thirdAddress] = concilium.getAddresses();

        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithAddr(myWalletAddress, myWalletAddress, sampleData);

        // my node got version of 2nd party
        newBft._addViewOfNodeWithAddr(myWalletAddress, anotherAddress, {data: 13});

        // my node got version of 3d party
        newBft._addViewOfNodeWithAddr(myWalletAddress, thirdAddress, sampleData);

        // receive 2nd party view my version
        newBft._addViewOfNodeWithAddr(anotherAddress, myWalletAddress, {data: 14});

        // receive 2nd party view of own version
        newBft._addViewOfNodeWithAddr(anotherAddress, anotherAddress, {data: 15});

        // receive from 2nd party version of 3d party
        newBft._addViewOfNodeWithAddr(anotherAddress, thirdAddress, {data: 16});

        // receive 3d party view my version
        newBft._addViewOfNodeWithAddr(thirdAddress, myWalletAddress, sampleData);

        // receive 3d party own version
        newBft._addViewOfNodeWithAddr(thirdAddress, thirdAddress, sampleData);

        // receive 3d party own version of 2nd party
        newBft._addViewOfNodeWithAddr(thirdAddress, anotherAddress, {data: 17});

        const value = newBft.runConsensus();
        assert.deepEqual(value, sampleData);
    });

    it('should PASS 3 witness (MY data is wrong)', async () => {
        const {newBft, concilium} = createDummyBFT(0, 3);
        const [myWalletAddress, anotherAddress, thirdAddress] = concilium.getAddresses();

        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithAddr(myWalletAddress, myWalletAddress, {data: 11});

        // my node got version of 2nd party
        newBft._addViewOfNodeWithAddr(myWalletAddress, anotherAddress, sampleData);

        // my node got version of 3d party
        newBft._addViewOfNodeWithAddr(myWalletAddress, thirdAddress, sampleData);

        // receive 2nd party view my version
        newBft._addViewOfNodeWithAddr(anotherAddress, myWalletAddress, {data: 11});

        // receive 2nd party view of own version
        newBft._addViewOfNodeWithAddr(anotherAddress, anotherAddress, sampleData);

        // receive from 2nd party version of 3d party
        newBft._addViewOfNodeWithAddr(anotherAddress, thirdAddress, sampleData);

        // receive 3d party view my version
        newBft._addViewOfNodeWithAddr(thirdAddress, myWalletAddress, {data: 11});

        // receive 3d party own version
        newBft._addViewOfNodeWithAddr(thirdAddress, thirdAddress, sampleData);

        // receive 3d party own version of 2nd party
        newBft._addViewOfNodeWithAddr(thirdAddress, anotherAddress, sampleData);

        const value = newBft.runConsensus();
        assert.deepEqual(value, sampleData);
    });

    it('should FAIL 3 witness (two tries to misbehave)', async () => {
        const {newBft, concilium} = createDummyBFT(0, 3);
        const [myWalletAddress, anotherAddress, thirdAddress] = concilium.getAddresses();

        const sampleData = {data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithAddr(myWalletAddress, myWalletAddress, sampleData);

        // my node got version of 2nd party
        newBft._addViewOfNodeWithAddr(myWalletAddress, anotherAddress, {data: 13});

        // my node got version of 3d party
        newBft._addViewOfNodeWithAddr(myWalletAddress, thirdAddress, {data: 23});

        // receive 2nd party view my version
        newBft._addViewOfNodeWithAddr(anotherAddress, myWalletAddress, {data: 14});

        // receive 2nd party view of own version
        newBft._addViewOfNodeWithAddr(anotherAddress, anotherAddress, {data: 15});

        // receive from 2nd party version of 3d party
        newBft._addViewOfNodeWithAddr(anotherAddress, thirdAddress, {data: 16});

        // receive 3d party view my version
        newBft._addViewOfNodeWithAddr(thirdAddress, myWalletAddress, {data: 24});

        // receive 3d party own version
        newBft._addViewOfNodeWithAddr(thirdAddress, thirdAddress, {data: 25});

        // receive 3d party own version of 2nd party
        newBft._addViewOfNodeWithAddr(thirdAddress, anotherAddress, {data: 17});

        const value = newBft.runConsensus();
        assert.isNotOk(value);
    });

    it('should accept "non expose" witness message', async () => {
        const {arrKeyPairs, newBft} = createDummyBFT();
        const [keyPair1] = arrKeyPairs;

        const msg = new factory.Messages.MsgWitnessNextRound({conciliumId, roundNo: 12});

        msg.sign(keyPair1.privateKey);

        assert.isNotOk(newBft._views[keyPair1.address][keyPair1.address]);
        const wrapper = () => newBft.processMessage(msg);
        assert.doesNotThrow(wrapper);
        assert.isOk(newBft._views[keyPair1.address][keyPair1.address]);
        assert.equal(newBft._views[keyPair1.address][keyPair1.address].roundNo, msg.roundNo);
    });

    it('should accept "MsgExpose" witness message', async () => {
        const {arrKeyPairs, newWallet, newBft} = createDummyBFT();
        const [keyPair1, keyPair2] = arrKeyPairs;

        const msg = new factory.Messages.MsgWitnessNextRound({conciliumId, roundNo: 12});
        msg.sign(newWallet.privateKey);
        const msgExpose = new factory.Messages.MsgWitnessWitnessExpose(msg);
        msgExpose.sign(keyPair2.privateKey);

        assert.isNotOk(newBft._views[keyPair2.address][keyPair1.address]);
        const wrapper = () => newBft.processMessage(msgExpose);
        assert.doesNotThrow(wrapper);
        assert.isOk(newBft._views[keyPair2.address][keyPair1.address]);
        assert.equal(newBft._views[keyPair2.address][keyPair1.address].roundNo, msg.roundNo);
    });

    it('should reject message with bad signature', async function () {
        const keyPair3 = factory.Crypto.createKeyPair();
        const {newBft} = createDummyBFT();

        // wrong outer signature
        const msg = new factory.Messages.MsgWitnessNextRound({conciliumId, roundNo: 12});
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
        const roundNo = 1;

        newBft.shouldPublish = sinon.fake.returns(true);
        newBft._concilium.getRound = sinon.fake.returns(roundNo);

        // Message received from party
        const msgRoundParty = new factory.Messages.MsgWitnessNextRound({conciliumId, roundNo});
        msgRoundParty.sign(keyPair2.privateKey);
        newBft.processMessage(msgRoundParty);

        // My message
        const msgRoundMy = new factory.Messages.MsgWitnessNextRound({conciliumId, roundNo});
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

        // const prevRound = newBft._roundNo = 123;

        newBft._roundChangeHandler(false);

        assert.isOk(newBft._nextRound.calledOnce);
        assert.equal(newBft._state, factory.Constants.consensusStates.ROUND_CHANGE);
    });

    it('should enter BLOCK state from ROUND_CHANGE', async () => {
        const {newBft} = createDummyBFT();
        const roundNo = 864;
        const blockCreateHandler = sinon.fake();
        newBft.on('createBlock', blockCreateHandler);
        newBft._state = factory.Constants.consensusStates.ROUND_CHANGE;
        const msg = new factory.Messages.MsgWitnessNextRound({conciliumId, roundNo});
        msg.encode();
        newBft._concilium.getRound = sinon.fake.returns(roundNo);

        newBft._roundChangeHandler(true, {state: newBft._state, ...msg.content});

        assert.isNotOk(newBft._nextRound.calledOnce);
        assert.equal(newBft._state, factory.Constants.consensusStates.BLOCK);

        if (newBft.shouldPublish()) assert.isOk(blockCreateHandler.calledOnce);
    });

    it('should sync rounds and advance to BLOCK state', async () => {
        const {arrKeyPairs, newBft} = createDummyBFT();
        const [keyPair1, keyPair2] = arrKeyPairs;

        newBft._state = factory.Constants.consensusStates.ROUND_CHANGE;
        newBft._stateChange = sinon.fake();

        const createNextRoundMessage = (conciliumId, privateKey) => {
            const msg = new factory.Messages.MsgWitnessNextRound({conciliumId, roundNo: 864});
            msg.sign(privateKey);
            return msg;
        };

        // Message received from party
        const msgParty = createNextRoundMessage(conciliumId, keyPair2.privateKey);
        newBft.processMessage(msgParty);

        // My message
        const msgMy = createNextRoundMessage(conciliumId, keyPair1.privateKey);
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

        const createBlockRejectMessage = (conciliumId, privateKey) => {
            const msg = factory.Messages.MsgWitnessBlockVote.reject(conciliumId);
            msg.sign(privateKey);
            return msg;
        };

        // Message received from party
        const msgParty = createBlockRejectMessage(conciliumId, keyPair2.privateKey);
        newBft.processMessage(msgParty);

        // My message
        const msgMy = createBlockRejectMessage(conciliumId, keyPair1.privateKey);
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
        const createBlockAckMessage = (conciliumId, privateKey) => {
            const msgBlockAck = new factory.Messages.MsgWitnessBlockVote({conciliumId, blockHash: fakeBlockHash});
            msgBlockAck.sign(privateKey);
            return msgBlockAck;
        };

        // Message received from party
        const msgParty = createBlockAckMessage(conciliumId, keyPair2.privateKey);
        newBft.processMessage(msgParty);

        // My message
        const msgMy = createBlockAckMessage(conciliumId, keyPair1.privateKey);
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

        assert.isNotOk(newBft._views[newBft._wallet.address][newBft._wallet.address]);

        newBft.processValidBlock(createDummyBlock(factory));

        assert.isOk(newBft._block);
    });

    it('should move from ROUND_CHANGE to BLOCK state & create block', async () => {
        const {newBft} = createDummyBFT();
        newBft.shouldPublish = sinon.fake.returns(true);
        const blockCreateHandler = sinon.fake();

        const roundNo = 512;
        newBft._concilium.getRound = sinon.fake.returns(roundNo);

        newBft.on('createBlock', blockCreateHandler);

        newBft._stateChange(true, {
            state: factory.Constants.consensusStates.ROUND_CHANGE,
            data: Buffer.from([roundNo])
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
        const msg = newBft._createBlockAcceptMessage(conciliumId, blockHash);
        assert.isOk(msg.isWitnessBlockVote());
        assert.isOk(blockHash.equals(msg.blockHash));
    });

    it('should create REJECT vote message', async () => {
        const {newBft} = createDummyBFT();
        const msg = newBft._createBlockRejectMessage(conciliumId);
        assert.isOk(msg.isWitnessBlockVote());
        assert.isOk(msg.blockHash.equals(Buffer.from('reject')));
    });

    it('should fail to get signatures (no block)', async () => {
        const {newBft} = createDummyBFT();
        assert.throws(() => newBft._getSignaturesForBlock());
    });

    it('should get signatures', async () => {
        const {arrKeyPairs, newBft} = createDummyBFT(conciliumId, 2);

        newBft._resetState();
        newBft._block = createDummyBlock(factory);
        const buffHash = Buffer.from(newBft._block.getHash(), 'hex');

        // my node put own version
        newBft._addViewOfNodeWithAddr(arrKeyPairs[0].address, arrKeyPairs[0].address, {
            blockHash: buffHash,
            signature: factory.Crypto.sign(buffHash, arrKeyPairs[0].privateKey, 'hex')
        });

        // my node got version of party
        newBft._addViewOfNodeWithAddr(arrKeyPairs[0].address, arrKeyPairs[1].address, {
            blockHash: buffHash,
            signature: factory.Crypto.sign(buffHash, arrKeyPairs[1].privateKey, 'hex')
        });

        // receive party view my version
        newBft._addViewOfNodeWithAddr(arrKeyPairs[1].address, arrKeyPairs[0].address, {
            blockHash: buffHash,
            signature: factory.Crypto.sign(buffHash, arrKeyPairs[0].privateKey, 'hex')
        });

        // receive party view of own version
        newBft._addViewOfNodeWithAddr(arrKeyPairs[1].address, arrKeyPairs[1].address, {
            blockHash: buffHash,
            signature: factory.Crypto.sign(buffHash, arrKeyPairs[1].privateKey, 'hex')
        });

        // move this state to "archive". _getSignaturesForBlock works with it
        newBft._resetState();

        const arrSignatures = newBft._getSignaturesForBlock();
        assert.isOk(arrSignatures);
        assert.equal(arrSignatures.length, 2);
    });

    it('should FAIL get signatures (bad quorum)', async () => {
        const {newBft} = createDummyBFT(conciliumId, 2);
        newBft._block = createDummyBlock(factory);

        newBft._concilium.getQuorum = sinon.fake.returns(0);

        try {
            newBft._getSignaturesForBlock();
        } catch (e) {
            return;
        }
        throw new Error('Unexpected success');
    });

    it('should FAIL get signatures no votes', async () => {
        const {newBft} = createDummyBFT(conciliumId, 2);
        newBft._resetState();
        newBft._block = createDummyBlock(factory);

        const result = newBft._getSignaturesForBlock();
        assert.isNotOk(result);
    });
});
