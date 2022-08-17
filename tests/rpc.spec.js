'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
const sinon = require('sinon').createSandbox();
chai.use(require('chai-as-promised'));
const factory = require('./testFactory');

const {assert} = chai;
const {createDummyTx, createDummyBlock, pseudoRandomBuffer, generateAddress} = require('./testUtil');
const {prepareForStringifyObject} = require('../utils');

let fakeResult = {
    fake: 1,
    toObject: function() {
        return this;
    },
    getHash: function() {
        return 'dead';
    }
};
let node;

describe('RPC', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    beforeEach(() => {
        node = {
            rpcHandler: sinon.fake.resolves(fakeResult),
            storage: {}
        };
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create instance', async () => {
        new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
    });

    it('should create instance with rate limit', async () => {
        const rpc = new factory.RPC(node, {
            rpcAddress: factory.Transport.generateAddress(),
            ratelimit: {maxPerInterval: 20, msInterval: 1000}
        });
        assert.isOk(rpc._server.ratelimiter);
    });

    it('should emit TX event', async () => {
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const tx = new factory.Transaction(createDummyTx());

        const result = await rpc.sendRawTx({strTx: tx.encode().toString('hex')});
        assert.deepEqual(result, fakeResult);

        assert.isOk(node.rpcHandler.calledOnce);
        const [{event, content}] = node.rpcHandler.args[0];
        assert.isOk(event);
        assert.isOk(content);
        assert.equal(event, 'tx');
        assert.isOk(tx.equals(content));

    });

    it('should FAIL to send TX', async () => {
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const tx = new factory.Transaction(createDummyTx());
        node.rpcHandler = sinon.fake.throws('error');

        return assert.isRejected(rpc.sendRawTx({strTx: tx.encode().toString('hex')}));
    });

    it('should get TX receipt', async () => {
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const strTxHash = pseudoRandomBuffer().toString('hex');

        const result = await rpc.getTxReceipt({strTxHash});

        assert.deepEqual(prepareForStringifyObject(fakeResult), prepareForStringifyObject(result));

        assert.isOk(node.rpcHandler.calledOnce);
        const [{event, content}] = node.rpcHandler.args[0];

        assert.isOk(event);
        assert.isOk(content);
        assert.equal(event, 'txReceipt');
        assert.equal(content, strTxHash);
    });

    it('should PASS informWsSubscribers (no subscribers)', async () => {
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        rpc.informWsSubscribersNewBlock({block: createDummyBlock(factory), state: 'stable'});
    });

    it('should PASS informWsSubscribers about new block (has subscribers)', async () => {
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const fake = sinon.fake();
        rpc._server._objConnections['test1'] = {send: fake};

        rpc.informWsSubscribersNewBlock({block: createDummyBlock(factory), state: 'stable'});
        assert.isOk(fake.calledOnce);
    });

    it('should PASS informWsSubscribers about state changed (has subscribers)', async () => {
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const fake = sinon.fake();
        rpc._server._objConnections['test1'] = {send: fake};

        rpc.informWsSubscribersStableBlocks({arrHashes: [createDummyBlock(factory).getHash()], state: 'stable'});
        assert.isOk(fake.calledOnce);
    });

    it('should get block', async () => {
        const state = 12;
        const block = createDummyBlock(factory);
        const getBlockResults = {
            block,
            state
        };
        node = {
            rpcHandler: sinon.fake.resolves(getBlockResults),
            storage: {}
        };
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const strBlockHash = block.getHash();

        const result = await rpc.getBlock({strBlockHash});

        assert.deepEqual(
            prepareForStringifyObject(result),
            {
                block: prepareForStringifyObject(block.toObject()),
                hash: block.getHash(),
                state
            }
        );
    });

    it('should get prev block', async () => {
        const state = 'stable';
        const block = createDummyBlock(factory);

        const getBlockResults = [
            {
                block,
                state
            }];

        node = {
            rpcHandler: sinon.fake.resolves(getBlockResults),
            storage: {}
        };
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const strBlockHash = pseudoRandomBuffer().toString('hex');
        const [result] = await rpc.getPrev({strBlockHash});

        assert.deepEqual(
            prepareForStringifyObject(result),
            {
                block: prepareForStringifyObject(block.toObject()),
                hash: block.getHash(),
                state
            }
        );
    });

    it('should get next block', async () => {
        const state = 'stable';
        const block = createDummyBlock(factory);

        const getBlockResults = [
            {
                block,
                state
            }];

        node = {
            rpcHandler: sinon.fake.resolves(getBlockResults),
            storage: {}
        };
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const strBlockHash = pseudoRandomBuffer().toString('hex');

        const [result] = await rpc.getNext({strBlockHash});

        assert.deepEqual(
            prepareForStringifyObject(result),
            {
                block: prepareForStringifyObject(block.toObject()),
                hash: block.getHash(),
                state
            }
        );
    });

    it('should get tips', async () => {
        const block1 = createDummyBlock(factory);
        const block2 = createDummyBlock(factory);

        const state = 12;
        const fakeRpcHandler = [
            {block: block1, state},
            {block: block2, state}
        ];

        const expectedResults = [
            {hash: block1.getHash(), block: block1.toObject(), state},
            {hash: block2.getHash(), block: block2.toObject(), state}
        ];
        const node = {
            rpcHandler: sinon.fake.resolves(fakeRpcHandler),
            storage: {}
        };
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});

        const result = await rpc.getTips();
        assert.deepEqual(result, prepareForStringifyObject(expectedResults));
    });

    it('should throw error', (done) => {
        const node = {
            rpcHandler: sinon.fake.throws('RPC error'),
            storage: {}
        };

        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        rpc.getTx()
            .then(() => done('Unexpected success'))
            .catch(() => done());
    });

    it('should get TX', async () => {
        const pk = pseudoRandomBuffer(33);
        const tx = factory.Transaction.invokeContract(
            generateAddress().toString('hex'),
            {
                method: 'test',
                arrArguments: [1, 2, 3, 5]
            },
            155,
            generateAddress()
        );

        tx.addInput(pseudoRandomBuffer(), 3);
        tx.addInput(pseudoRandomBuffer(), 1);
        tx.addReceiver(1e3, generateAddress());
        tx.claim(0, pk);
        tx.claim(1, pk);
        tx.signForContract(pk);

        const node = {
            rpcHandler: sinon.fake.resolves(tx.rawData),
            storage: {}
        };

        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const resp = await rpc.getTx({strTxHash: tx.getHash()});

        assert.isOk(resp);
        assert.deepEqual(prepareForStringifyObject(resp), prepareForStringifyObject(tx.rawData));
    });

    it('should pass constantMethodCall', async () => {
        const node = {
            rpcHandler: sinon.fake.resolves(20),
            storage: {}
        };

        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const resp = await rpc.constantMethodCall({
            method: 'test',
            arrArguments: [],
            contractAddress: generateAddress().toString('hex')
        });

        assert.equal(resp, 20);
    });

    it('should pass getUnspent', async () => {
        const objExpected = {1: {amount: 10, receiverAddr: generateAddress().toString('hex')}};
        const node = {
            rpcHandler: sinon.fake.resolves(objExpected),
            storage: {}
        };

        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const resp = await rpc.getUnspent({
            strTxHash: pseudoRandomBuffer().toString('hex')
        });

        assert.deepEqual(resp, objExpected);
    });

    it('should pass walletListUnspent', async () => {
        const hash1 = pseudoRandomBuffer().toString('hex');
        const hash2 = pseudoRandomBuffer().toString('hex');
        const addr = generateAddress();

        const objExpected = [
            {
                hash: hash1.toString('hex'),
                nOut: 0,
                amount: 100000,
                isStable: true
            },
            {
                hash: hash2.toString('hex'),
                nOut: 5,
                amount: 100000,
                isStable: false
            },
            {
                hash: hash2.toString('hex'),
                nOut: 2,
                amount: 100000,
                isStable: false
            }];

        const coins = new factory.Coins(1e5, addr);
        const coinsOther = new factory.Coins(1e5, generateAddress());
        const utxo1 = new factory.UTXO({txHash: hash1});
        utxo1.addCoins(0, coins);

        const utxo2 = new factory.UTXO({txHash: hash2});
        utxo2.addCoins(5, coins);
        utxo2.addCoins(2, coins);
        utxo2.addCoins(7, coinsOther);

        const node = {
            storage: {
                walletListUnspent: sinon.fake.resolves([utxo1])
            },
            getPendingUtxos: () => [utxo2]
        };

        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const resp = await rpc.walletListUnspent({
            strAddress: addr.toString('hex'),
            bStableOnly: false
        });

        assert.deepEqual(resp, objExpected);
    });

    it('should get Balance', async () => {
        const hash1 = pseudoRandomBuffer().toString('hex');
        const hash2 = pseudoRandomBuffer().toString('hex');
        const addr = generateAddress();

        const coins = new factory.Coins(1e5, addr);
        const utxo1 = new factory.UTXO({txHash: hash1});
        utxo1.addCoins(0, coins);

        const utxo2 = new factory.UTXO({txHash: hash2});
        utxo2.addCoins(5, coins);
        utxo2.addCoins(2, coins);

        const node = {
            storage: {
                walletListUnspent: sinon.fake.resolves([utxo1])
            },
            getPendingUtxos: () => [utxo2]
        };

        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});

        const resp = await rpc.getBalance({
            strAddress: addr.toString('hex'),
            bStableOnly: false
        });

        assert.deepEqual(resp, {
            confirmedBalance: 1e5,
            unconfirmedBalance: 2e5
        });
    });

    it('should getLastBlockByConciliumId', async () => {
        const node = {
            rpcHandler: sinon.fake.resolves(pseudoRandomBuffer().toString('hex')),
            storage: {}
        };

        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});

        // --------
        const resp = await rpc.getLastBlockByConciliumId({nConciliumId: 1});

        assert.isOk(resp && resp.length === 64);
    });

    it('should getAccountUnspent', async () => {
        const hash1 = pseudoRandomBuffer().toString('hex');
        const hash2 = pseudoRandomBuffer().toString('hex');
        const addr = generateAddress();
        const addr2 = generateAddress();
        const coins = new factory.Coins(1e5, addr);
        const coinsOther = new factory.Coins(1e3, addr2);

        const utxo1 = new factory.UTXO({txHash: hash1});
        utxo1.addCoins(0, coins);
        utxo1.addCoins(3, coinsOther);

        const utxo2 = new factory.UTXO({txHash: hash2});
        utxo2.addCoins(5, coins);
        utxo2.addCoins(2, coinsOther);

        const node = {
            storage: {},
            getPendingUtxos: () => [utxo2]
        };

        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        rpc._storedWallets = {
            getAccountAddresses: async () => [addr2.toString('hex'), addr.toString('hex')],
            walletListUnspent: async (address) => [utxo1.filterOutputsForAddress(address)]
        };

        const arrExpected = [
            {
                hash: hash1.toString('hex'),
                nOut: 3,
                amount: 1000,
                isStable: true,
                receiver: addr2.toString('hex')
            },
            {
                hash: hash1.toString('hex'),
                nOut: 0,
                amount: 100000,
                isStable: true,
                receiver: addr.toString('hex')
            },
            {
                hash: hash2.toString('hex'),
                nOut: 2,
                amount: 1000,
                isStable: false,
                receiver: addr2.toString('hex')
            },
            {
                hash: hash2.toString('hex'),
                nOut: 5,
                amount: 100000,
                isStable: false,
                receiver: addr.toString('hex')
            }];

        // --------
        const arrUtxos = await rpc.getAccountUnspent('test', false);

        assert.isOk(arrUtxos.length === 4);
        assert.deepEqual(arrUtxos, arrExpected);
    });

    it('should getAccountBalance', async () => {
        const hash1 = pseudoRandomBuffer().toString('hex');
        const hash2 = pseudoRandomBuffer().toString('hex');
        const addr = generateAddress();
        const addr2 = generateAddress();
        const coins = new factory.Coins(1e5, addr);
        const coinsOther = new factory.Coins(1e3, addr2);

        const utxo1 = new factory.UTXO({txHash: hash1});
        utxo1.addCoins(0, coins);
        utxo1.addCoins(3, coinsOther);

        const utxo2 = new factory.UTXO({txHash: hash2});
        utxo2.addCoins(5, coinsOther);

        const node = {
            storage: {},
            getPendingUtxos: () => [utxo2]
        };

        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        rpc._storedWallets = {
            getAccountAddresses: async () => [addr2, addr],
            walletListUnspent: async (address) => [utxo1.filterOutputsForAddress(address)]
        };

        const objExpected = {confirmedBalance: 1e5 + 1e3, unconfirmedBalance: 1e3};

        // --------
        const objResult = await rpc.getAccountBalance('test', false);

        assert.deepEqual(objResult, objExpected);
    });
});
