'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('./testFactory');
const {pseudoRandomBuffer} = require('./testUtil');

describe('Array of hashes (serialization)', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    it('should fail to create', async () => {
        assert.throws(() => new factory.ArrayOfHashes());
    });

    it('should fail to create (bad hash length)', async () => {
        assert.throws(() => new factory.ArrayOfHashes([pseudoRandomBuffer(10)]));
        assert.throws(() => new factory.ArrayOfHashes([pseudoRandomBuffer(), pseudoRandomBuffer(10)]));
    });

    it('should create from array', async () => {
        new factory.ArrayOfHashes([pseudoRandomBuffer()]);
        new factory.ArrayOfHashes([pseudoRandomBuffer(), pseudoRandomBuffer()]);
    });

    it('should create from buffer', async () => {
        const cArr = new factory.ArrayOfHashes(pseudoRandomBuffer(96));
        assert.isOk(Array.isArray(cArr.getArray()));
        assert.equal(cArr.getArray().length, 3);
    });

    it('should encode', async () => {
        const cArr = new factory.ArrayOfHashes([pseudoRandomBuffer(), pseudoRandomBuffer()]);
        const buffEncoded = cArr.encode();
        assert.isOk(Buffer.isBuffer(buffEncoded));
        assert.equal(buffEncoded.length, 64);
    });
});
