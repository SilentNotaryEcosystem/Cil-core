'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('./testFactory');
const {pseudoRandomBuffer, generateAddress} = require('./testUtil');

describe('Array of addresses (serialization)', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    it('should fail to create', async () => {
        assert.throws(() => new factory.ArrayOfAddresses());
    });

    it('should fail to create (bad address length)', async () => {
        assert.throws(() => new factory.ArrayOfAddresses([pseudoRandomBuffer(10)]));
        assert.throws(() => new factory.ArrayOfAddresses([generateAddress(), pseudoRandomBuffer(10)]));
    });

    it('should create from array', async () => {
        new factory.ArrayOfAddresses([generateAddress()]);
        new factory.ArrayOfAddresses([generateAddress(), generateAddress()]);
    });

    it('should create from buffer', async () => {
        const cArr = new factory.ArrayOfAddresses(pseudoRandomBuffer(80));
        assert.isOk(Array.isArray(cArr.getArray()));
        assert.equal(cArr.getArray().length, 4);
    });

    it('should encode', async () => {
        const cArr = new factory.ArrayOfAddresses([generateAddress(), generateAddress()]);
        const buffEncoded = cArr.encode();
        assert.isOk(Buffer.isBuffer(buffEncoded));
        assert.equal(buffEncoded.length, 40);
    });
});
