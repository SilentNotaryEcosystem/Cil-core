'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const {UnsDid: UnsDidContract} = require('./unsDid');
const factory = require('../../testFactory');
const {ADDRESS_TYPE, DID_PREFIX} = require('./constants');

let contract;

describe('UnsDid', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function () {
        // this.timeout(15000);
    });

    beforeEach(async () => {
        // global.value = 0;
        // global.callerAddress = generateAddress().toString('hex');
        // global.contractTx = pseudoRandomBuffer().toString('hex');
        // global.block = {
        //     height: 100,
        //     hash: 'hash'
        // };

        contract = new UnsDidContract();
    });

    it('should get UNS address in 3 different formats', () => {
        const name = 'mytestname';
        const address = 0x121212121212;
        const resolver = contract.getUnsProviderResolver('ubix');
        const objDidDocument = {
            id: `did:ubix:${address}`,
            tg: 'my-tele-nick',
            email: 'my-email@test.com'
        };

        resolver.add(name, address);
        contract._addDidDocument(address, objDidDocument);

        assert.equal(Object.keys(contract._hash2address).length, 1);
        assert.equal(resolver.get(name), address);
        assert.equal(resolver.get(name, ADDRESS_TYPE.DID_ID), `${DID_PREFIX}:${address}`);
        assert.equal(JSON.stringify(resolver.get(name, ADDRESS_TYPE.DID_DOCUMENT)), JSON.stringify(objDidDocument));
    });
});
