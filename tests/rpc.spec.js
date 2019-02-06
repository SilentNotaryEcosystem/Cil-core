'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();

const factory = require('./testFactory');
const {createDummyTx, pseudoRandomBuffer} = require('./testUtil');

let fakeResult = {fake: 1};
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

        const result = await rpc.sendRawTx({buffTx: tx.encode()});
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
        assert.deepEqual(result, fakeResult);

        assert.isOk(node.rpcHandler.calledOnce);
        const [{event, content}] = node.rpcHandler.args[0];

        assert.isOk(event);
        assert.isOk(content);
        assert.equal(event, 'txReceipt');
        assert.equal(content, strTxHash);
    });

    it('should PASS informWsSubscribers (no subscribers)', async () => {
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        rpc.informWsSubscribers('test', {a: 1, b: 2});
    });

    it('should PASS informWsSubscribers (has subscribers)', async () => {
        const rpc = new factory.RPC(node, {rpcAddress: factory.Transport.generateAddress()});
        const fake = sinon.fake();
        rpc._server._objConnections['test1'] = {send: fake};

        rpc.informWsSubscribers('testTopic', {a: 1, b: 2});
        assert.isOk(fake.calledOnce);
    });

});
