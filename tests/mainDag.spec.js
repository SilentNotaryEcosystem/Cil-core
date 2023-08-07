'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();
const Mutex = require('mutex');

const config = require('../config/test.conf');
const TestFactory = require('./testFactory');
const {createDummyBlockInfo} = require('./testUtil');

const factory = new TestFactory(
    {
        testStorage: true,
        mutex: new Mutex(),
        workerSuspended: true,
        bDev: true
    },
    config.constants
);

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

describe('Main Dag', () => {
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
        new factory.MainDag();
    });

    it('should rewrite vertex (add multiple times)', async () => {
        const dag = new factory.MainDag();
        const bi = createDummyBlockInfo(factory);

        dag.addBlock(bi);

        // this block & parent
        assert.equal(dag.order, 2);
        assert.equal(dag.size, 1);

        await dag.addBlock(bi);
        await dag.addBlock(bi);
        await dag.addBlock(bi);

        // this block & parent
        assert.equal(dag.order, 2);
        assert.equal(dag.size, 1);
    });
});
