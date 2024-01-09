'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();

const factory = require('./testFactory');
const {createDummyTx, pseudoRandomBuffer} = require('./testUtil');

let cache;

describe('Request Cache', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    beforeEach(() => {
        cache = new factory.RequestCache();
    });

    it('should signal to request hash (buffer)', async () => {
        assert.isOk(cache.request(pseudoRandomBuffer()));
    });

    it('should signal to request hash (string)', async () => {
        assert.isOk(cache.request(pseudoRandomBuffer().toString('hex')));
    });

    it('should NOT signal to request hash second time', async () => {
        const hash = pseudoRandomBuffer();
        assert.isOk(cache.request(hash));
        assert.isNotOk(cache.request(hash));
    });

    it('should REREQUEST after HOLDOFF', async () => {
        const strHash = pseudoRandomBuffer().toString('hex');
        assert.isOk(cache.request(strHash));
        cache._mapRequests.set(strHash, Date.now() - 1);
        assert.isOk(cache.request(strHash));
    });

    it('should clear successfully requested item', async () => {
        const hash = pseudoRandomBuffer();
        assert.isOk(cache.request(hash));
        cache.done(hash);

        // we can request it again
        assert.isOk(cache.request(hash));
    });

    it('should PASS isRequested for HOLDOFF period', async () => {
        const strHash = pseudoRandomBuffer().toString('hex');
        cache.request(strHash);

        assert.isOk(cache.isRequested(strHash));

        cache._mapRequests.set(strHash, Date.now() - 1);
        assert.isNotOk(cache.isRequested(strHash));
    });
});
