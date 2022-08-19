const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('../testFactory');

const conciliumId = 11;

const createDummyBFT = (conciliumId = 0, numOfKeys = 2) => {
    const arrKeyPairs = [];
    const arrPublicKeys = [];
    for (let i = 0; i < numOfKeys; i++) {
        const keyPair = factory.Crypto.createKeyPair();
        arrKeyPairs.push(keyPair);
        arrPublicKeys.push(keyPair.publicKey);
    }
    const newWallet = new factory.Wallet(arrKeyPairs[0].privateKey);

    const concilium = factory.ConciliumRr.create(conciliumId, arrPublicKeys);

    const newBft = new factory.BFT({
        concilium,
        wallet: newWallet
    });
    newBft._stopTimer();

    return {arrKeyPairs, newWallet, concilium, newBft};
};

const createBlockAckMessage = (conciliumId, privateKey, blockHash) => {
    const msgBlockAck = new factory.Messages.MsgWitnessBlockVote({conciliumId, blockHash});
    msgBlockAck.sign(privateKey);
    return msgBlockAck;
};

describe('BFT consensus integration tests', () => {
    before(async function () {
        this.timeout(15000);

        await factory.asyncLoad();
    });

    after(async function () {
        this.timeout(15000);
    });

    it('should fail to get signatures (voted for different blocks)', async () => {
        const {arrKeyPairs, newBft} = createDummyBFT();
        const [keyPair1, keyPair2] = arrKeyPairs;

        const fakeBlockHash = Buffer.from(factory.Crypto.randomBytes(32));
        const fakeBlockHash2 = Buffer.from(factory.Crypto.randomBytes(32));

        newBft._resetState();
        newBft._block = {
            hash: () => fakeBlockHash.toString('hex')
        };

        const createBlockAckMessage = (conciliumId, privateKey, blockHash) => {
            const msgBlockAck = new factory.Messages.MsgWitnessBlockVote({conciliumId, blockHash});
            msgBlockAck.sign(privateKey);
            return msgBlockAck;
        };

        // Message received from party
        const msgParty = createBlockAckMessage(conciliumId, keyPair2.privateKey, fakeBlockHash);
        newBft._addViewOfNodeWithPubKey(keyPair2.publicKey, keyPair2.publicKey, {...msgParty.content});

        // My message
        const msgMy = createBlockAckMessage(conciliumId, keyPair1.privateKey, fakeBlockHash2);
        newBft._addViewOfNodeWithPubKey(keyPair1.publicKey, keyPair1.publicKey, {...msgMy.content});

        // My message returned by party
        newBft._addViewOfNodeWithPubKey(keyPair2.publicKey, keyPair1.publicKey, {...msgMy.content});

        // Party message exposed by me
        newBft._addViewOfNodeWithPubKey(keyPair1.publicKey, keyPair2.publicKey, {...msgParty.content});

        const arrSignatures = newBft._getSignaturesForBlock();
        assert.isNotOk(arrSignatures);
    });

    it('should get signatures', async () => {
        const {arrKeyPairs, newBft} = createDummyBFT();
        const [keyPair1, keyPair2] = arrKeyPairs;

        const fakeBlockHash = Buffer.from(factory.Crypto.randomBytes(32));

        newBft._resetState();
        newBft._block = {
            hash: () => fakeBlockHash.toString('hex')
        };

        // Message received from party
        const msgParty = createBlockAckMessage(conciliumId, keyPair2.privateKey, fakeBlockHash);
        newBft._addViewOfNodeWithPubKey(keyPair2.publicKey, keyPair2.publicKey, {...msgParty.content});

        // My message
        const msgMy = createBlockAckMessage(conciliumId, keyPair1.privateKey, fakeBlockHash);
        newBft._addViewOfNodeWithPubKey(keyPair1.publicKey, keyPair1.publicKey, {...msgMy.content});

        // My message returned by party
        newBft._addViewOfNodeWithPubKey(keyPair2.publicKey, keyPair1.publicKey, {...msgMy.content});

        // Party message exposed by me
        newBft._addViewOfNodeWithPubKey(keyPair1.publicKey, keyPair2.publicKey, {...msgParty.content});

        // emulate workflow, state will be reset and _getSignaturesForBlock will use stored _prevViews
        newBft._resetState();
        const arrSignatures = newBft._getSignaturesForBlock();
        assert.isOk(arrSignatures);
        assert.equal(arrSignatures.length, 2);

        // it depends on sorting
        assert.isOk(arrSignatures[0].equals(msgMy.hashSignature) || arrSignatures[1].equals(msgMy.hashSignature));
        assert.isOk(arrSignatures[0].equals(msgParty.hashSignature) || arrSignatures[1].equals(msgParty.hashSignature));
    });
});
