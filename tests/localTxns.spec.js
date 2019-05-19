'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();
const fs = require('fs');

process.env.DEBUG += ';localTxns:*';
const debug = require('debug')('localTxns:test');

const factory = require('./testFactory');
const {createDummyTx, pseudoRandomBuffer} = require('./testUtil');

let localTxns;
describe('Local TXns tests', () => {
    before(async function() {
        await factory.asyncLoad();
    });

    beforeEach(async () => {
        sinon.stub(fs, 'readFileSync').returns('{}');
        localTxns = new factory.LocalTxns();
        sinon.restore();
    });

    afterEach(() => {
        sinon.restore();
    });

    it('should create', async () => {
        assert.isOk(localTxns);
    });

    it('should add TX', async () => {
        localTxns._dumpToDisk = sinon.fake();
        const tx = new factory.Transaction(createDummyTx());

        localTxns.addTx(tx);

        assert.isOk(Array.isArray(localTxns.getAllTxnHashes()) && localTxns.getAllTxnHashes().length === 1);
        assert.isOk(localTxns._dumpToDisk.calledOnce);
    });

    it('should delete tx', async () => {
        localTxns._dumpToDisk = sinon.fake();
        const tx = new factory.Transaction(createDummyTx());
        localTxns.addTx(tx);

        localTxns.removeTx(tx.getHash());

        assert.isOk(Array.isArray(localTxns.getAllTxnHashes()) && localTxns.getAllTxnHashes().length === 0);
        assert.equal(localTxns._dumpToDisk.callCount, 2);
    });

    it('should remove multiple', async () => {
        localTxns.removeTx = sinon.fake();
        localTxns._dumpToDisk = sinon.fake();

        localTxns.removeForBlock([pseudoRandomBuffer(), pseudoRandomBuffer(), pseudoRandomBuffer()]);

        assert.equal(localTxns.removeTx.callCount, 3);
    });

    it('should dump to disk', async () => {
        const stub = sinon.stub(fs, 'writeFileSync');
        const tx = new factory.Transaction(createDummyTx());
        localTxns._mapTxns.set(tx.getHash(), tx);

        localTxns._dumpToDisk();

        assert.isOk(stub.calledOnce);
        const [, strJson] = stub.args[0];
        const objSaved = JSON.parse(strJson);
        assert.deepEqual(objSaved, {[tx.getHash()]: tx.encode().toString('hex')});
    });

    it('should load from disk', async () => {
        sinon.stub(fs, 'readFileSync')
            .returns(
                '{"0a48cb13f67da62195d60dc2ace499a97ec29537b86bbf161ca6cd1998b006c3": "0a4c0a250a20ed000000000000000000000000000000000000000000000070706e0300000000109307121f095b010000000000001214dc6b50030000000040706e030000000007f5152e180120001220ec6c50030000000088706e03000000007f24aa3e04000000c8726e0300000000"}');

        localTxns._loadFromDisk();

        assert.isOk(Array.isArray(localTxns.getAllTxnHashes()) && localTxns.getAllTxnHashes().length === 1);
    });
});
