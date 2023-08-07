'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const Mutex = require('mutex');

const config = require('../../config/test.conf');
const TestFactory = require('../testFactory');
const {pseudoRandomBuffer} = require('../testUtil');
const {arrayEquals} = require('../../utils');

const factory = new TestFactory(
    {
        testStorage: true,
        mutex: new Mutex(),
        workerSuspended: true,
        bDev: true
    },
    config.constants
);

describe('MessageGetBlocks', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create empty message', async () => {
        const msg = new factory.Messages.MsgGetBlocks();
        assert.isOk(msg.isGetBlocks());
    });

    it('should create from object', async () => {
        const arrHashes = [pseudoRandomBuffer(), pseudoRandomBuffer()];
        new factory.Messages.MsgGetBlocks({
            arrHashes
        });
    });

    it('should get arrHashes', async () => {
        const arrHashes = [pseudoRandomBuffer().toString('hex'), pseudoRandomBuffer().toString('hex')];
        const msg = new factory.Messages.MsgGetBlocks({
            arrHashes
        });

        assert.isOk(Array.isArray(msg.arrHashes));
        assert.isOk(arrayEquals(msg.arrHashes, arrHashes));
    });

    it('should set arrHashes', async () => {
        const arrHashes = [pseudoRandomBuffer().toString('hex'), pseudoRandomBuffer().toString('hex')];
        const msg = new factory.Messages.MsgGetBlocks();
        msg.arrHashes = arrHashes;

        assert.isOk(Array.isArray(msg.arrHashes));
        assert.isOk(arrayEquals(msg.arrHashes, arrHashes));
    });

    it('should encode/decode message', async () => {
        const arrHashes = [pseudoRandomBuffer().toString('hex'), pseudoRandomBuffer().toString('hex')];
        const msg = new factory.Messages.MsgGetBlocks();
        msg.arrHashes = arrHashes;

        const buff = msg.encode();

        const restored = new factory.Messages.MsgGetBlocks(buff);
        assert.isOk(Array.isArray(restored.arrHashes));
        assert.isOk(arrayEquals(restored.arrHashes, arrHashes));
    });
});
