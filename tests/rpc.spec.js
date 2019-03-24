'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();

const factory = require('./testFactory');
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
            rpcHandler: sinon.fake.resolves(fakeResult)
        };
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create instance', async () => {
        new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
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

    it('should get TX receipt', async () => {
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const strTxHash = pseudoRandomBuffer().toString('hex');

        const result = await rpc.getTxReceipt({strTxHash});

        // prepareForStringifyObject(fakeResult) will strip functions from fake
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
        rpc.informWsSubscribers('test', createDummyBlock(factory));
    });

    it('should PASS informWsSubscribers about new block (has subscribers)', async () => {
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const fake = sinon.fake();
        rpc._server._objConnections['test1'] = {send: fake};

        const cBlock = createDummyBlock(factory);
        rpc.informWsSubscribers('newBlock', {block: createDummyBlock(factory), state:8});
        assert.isOk(fake.calledOnce);
    });

    it('should PASS informWsSubscribers about state changed (has subscribers)', async () => {
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const fake = sinon.fake();
        rpc._server._objConnections['test1'] = {send: fake};

        const cBlock = createDummyBlock(factory);
        rpc.informWsSubscribers('stateChanged', {hashes: [createDummyBlock(factory).getHash()], state:8});
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
            rpcHandler: sinon.fake.resolves(getBlockResults)
        };
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const strBlockHash = pseudoRandomBuffer().toString('hex');

        const result = await rpc.getBlock({strBlockHash});

        // prepareForStringifyObject(fakeResult) will strip functions from fake
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
        const state = 12;
        const block = createDummyBlock(factory);
        const getBlockResults = [{
            block,
            state
        }];

        node = {
            rpcHandler: sinon.fake.resolves(getBlockResults)
        };
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const strBlockHash = pseudoRandomBuffer().toString('hex');

        const [result] = await rpc.getPrev({strBlockHash});

        // prepareForStringifyObject(fakeResult) will strip functions from fake
        assert.deepEqual(
            prepareForStringifyObject(result),
            {
                block: prepareForStringifyObject(block),
                hash: block.getHash(),
                state
            }
        );
    });

    it('should get prev block', async () => {
        const state = 12;
        const block = createDummyBlock(factory);
        const getBlockResults = [{
            block,
            state
        }];

        node = {
            rpcHandler: sinon.fake.resolves(getBlockResults)
        };
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const strBlockHash = pseudoRandomBuffer().toString('hex');

        const [result] = await rpc.getNext({strBlockHash});

        // prepareForStringifyObject(fakeResult) will strip functions from fake
        assert.deepEqual(
            prepareForStringifyObject(result),
            {
                block: prepareForStringifyObject(block),
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
            rpcHandler: sinon.fake.resolves(fakeRpcHandler)
        };
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});

        const result = await rpc.getTips();
        assert.deepEqual(result, prepareForStringifyObject(expectedResults));
    });

    it('should throw error', (done) => {
        const node = {
            rpcHandler: sinon.fake.throws('RPC error')
        };

        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        rpc.getTips()
            .then(_ => done('Unexpected success'))
            .catch(_ => done());
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
            rpcHandler: sinon.fake.resolves(tx.rawData)
        };

        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const resp = await rpc.getTx({strTxHash: tx.getHash()});

        assert.isOk(resp);
//        console.dir(resp, {colors: true, depth: null});
        assert.deepEqual(prepareForStringifyObject(resp), prepareForStringifyObject(tx.rawData));
    });
});
