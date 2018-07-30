const {describe, it} = require('mocha');
const {assert} = require('chai');

factory = require('./testFactory');

const myNetwork={
    myAddress: 'myIP'
};
const myWallet={
    publicKey: 'myPublicKey'
};
const myStorage={
    height: 1
};
const myMempool={
    transactions:[
        'transaction1',
        'transaction2'
    ]
};

let BFT;

describe('BFT general tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
        BFT = factory.BFT;
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should PASS (one witness)', async () => {
        const newBft=new BFT({
            network: myNetwork,
            group: 'test',
            arrPublicKeys: [myWallet.publicKey],
            storage: myStorage,
            mempool: myMempool,
            wallet: myWallet
        });
        const sampleData={data: 1};
        newBft._resetState();
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, myWallet.publicKey, sampleData);
        const value=newBft.runConsensus();
        assert.deepEqual(sampleData, value);
    });

    it('should PASS (two witness same data)', async () => {
        const newBft=new BFT({
            network: myNetwork,
            group: 'test',
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey'],
            storage: myStorage,
            mempool: myMempool,
            wallet: myWallet
        });
        const sampleData={data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, myWallet.publicKey, sampleData);

        // my node got version of party
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'anotherPubKey', sampleData);

        // receive party view my version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', myWallet.publicKey, sampleData);

        // receive party view of own version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'anotherPubKey', sampleData);
        const value=newBft.runConsensus();
        assert.deepEqual(sampleData, value);
    });

    it('should FAIL (two witness different data)', async () => {
        const newBft=new BFT({
            network: myNetwork,
            group: 'test',
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey'],
            storage: myStorage,
            mempool: myMempool,
            wallet: myWallet
        });
        const sampleData={data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, myWallet.publicKey, sampleData);

        // my node got version of party
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'anotherPubKey', undefined);

        // receive party view my version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', myWallet.publicKey, sampleData);

        // receive party view of own version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'anotherPubKey', undefined);
        const value=newBft.runConsensus();
        assert.isNotOk(value);
    });

    it('should FAIL (two witness party tries to forge my data)', async () => {
        const newBft=new BFT({
            network: myNetwork,
            group: 'test',
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey'],
            storage: myStorage,
            mempool: myMempool,
            wallet: myWallet
        });
        const sampleData={data: 1};
        newBft._resetState();

        // my node put own version
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, myWallet.publicKey, sampleData);

        // my node got version of party
        newBft._addViewOfNodeWithPubKey(myWallet.publicKey, 'anotherPubKey', sampleData);

        // receive party view my version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', myWallet.publicKey, undefined);

        // receive party view of own version
        newBft._addViewOfNodeWithPubKey('anotherPubKey', 'anotherPubKey', sampleData);
        const value=newBft.runConsensus();
        assert.isNotOk(value);
    });

    it('should PASS 3 witness same data', async () => {
        const newBft=new BFT({
            network: myNetwork,
            group: 'test',
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey', 'thirdPubKey'],
            storage: myStorage,
            mempool: myMempool,
            wallet: myWallet
        });
        const sampleData={data: 1};
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

        const value=newBft.runConsensus();
        assert.deepEqual(value, sampleData);
    });

    it('should PASS 3 witness (one dead)', async () => {
        const newBft=new BFT({
            network: myNetwork,
            group: 'test',
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey', 'thirdPubKey'],
            storage: myStorage,
            mempool: myMempool,
            wallet: myWallet
        });
        const sampleData={data: 1};
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

        const value=newBft.runConsensus();
        assert.deepEqual(value, sampleData);
    });

    it('should PASS 3 witness (one tries to misbehave)', async () => {
        const newBft=new BFT({
            network: myNetwork,
            group: 'test',
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey', 'thirdPubKey'],
            storage: myStorage,
            mempool: myMempool,
            wallet: myWallet
        });
        const sampleData={data: 1};
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

        const value=newBft.runConsensus();
        assert.deepEqual(value, sampleData);
    });

    it('should PASS 3 witness (MY data is wrong)', async () => {
        const newBft=new BFT({
            network: myNetwork,
            group: 'test',
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey', 'thirdPubKey'],
            storage: myStorage,
            mempool: myMempool,
            wallet: myWallet
        });
        const sampleData={data: 1};
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

        const value=newBft.runConsensus();
        assert.deepEqual(value, sampleData);
    });

    it('should FAIL 3 witness (two tries to misbehave)', async () => {
        const newBft=new BFT({
            network: myNetwork,
            group: 'test',
            arrPublicKeys: [myWallet.publicKey, 'anotherPubKey', 'thirdPubKey'],
            storage: myStorage,
            mempool: myMempool,
            wallet: myWallet
        });
        const sampleData={data: 1};
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

        const value=newBft.runConsensus();
        assert.isNotOk(value);
    });
});
