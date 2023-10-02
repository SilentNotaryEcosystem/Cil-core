'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();

const {getNewTestFactory} = require('./testFactory');
const factory = getNewTestFactory({USE_MAIN_DAG_INDEX: true});
const {createDummyBlockInfo} = require('./testUtil');

let fakeResult = {
    fake: 1,
    toObject: function () {
        return this;
    },
    getHash: function () {
        return 'dead';
    }
};
let node;

describe('Main Dag Index', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    beforeEach(() => {
        node = {
            rpcHandler: sinon.fake.resolves(fakeResult)
        };
    });

    after(async function () {
        this.timeout(15000);
    });

    it('should create instance', async () => {
        new factory.MainDagIndex({storage: new factory.Storage({})});
    });

    it('should add one vertex (no parent blocks have found)', async () => {
        const dag = new factory.MainDagIndex({storage: new factory.Storage({})});
        const bi = createDummyBlockInfo(factory);

        await dag.addBlock(bi);

        assert.equal(await dag.getOrder(), 1);
    });

    it('should rewrite vertex (add multiple times)', async () => {
        const dag = new factory.MainDagIndex({storage: new factory.Storage({})});
        const bi = createDummyBlockInfo(factory);
        bi.getHeight = sinon.fake.returns(1);
        const biParent = createDummyBlockInfo(factory);
        dag._storage.getDagBlockInfo = sinon.fake.resolves(biParent);

        await dag.addBlock(bi);

        // this block & parent
        assert.equal(await dag.getOrder(), 2);

        await dag.addBlock(bi);
        await dag.addBlock(bi);
        await dag.addBlock(bi);

        // this block & parent
        assert.equal(await dag.getOrder(), 2);
    });

    it('should add and remove vertex (with parent block)', async () => {
        const dag = new factory.MainDagIndex({storage: new factory.Storage({})});
        const bi = createDummyBlockInfo(factory);
        bi.getHeight = sinon.fake.returns(1);
        const biParent = createDummyBlockInfo(factory);
        dag._storage.getDagBlockInfo = sinon.fake.resolves(biParent);

        await dag.addBlock(bi);

        // this block & parent
        assert.equal(await dag.getOrder(), 2);

        await dag.removeBlock(bi);

        // this block & parent
        assert.equal(await dag.getOrder(), 0);
    });

    it('should add and remove vertex (without parent block)', async () => {
        const dag = new factory.MainDagIndex({storage: new factory.Storage({})});
        const bi = createDummyBlockInfo(factory);

        await dag.addBlock(bi);

        assert.equal(await dag.getOrder(), 1);

        await dag.removeBlock(bi);

        assert.equal(await dag.getOrder(), 0);
    });
});
