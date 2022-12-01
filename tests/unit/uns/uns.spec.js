'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const {Uns: UnsContract} = require('./uns');
const factory = require('../../testFactory');

let contract;

describe('Uns', () => {
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

        contract = new UnsContract();
    });

    it('should add a new record to UNS', () => {
        const name = 'mytestname';
        const address = 0x121212121212;
        const resolver = contract.getUnsProviderResolver('ubix');

        assert.equal(Object.keys(contract._hash2address).length, 0);

        resolver.add(name, address);

        assert.equal(Object.keys(contract._hash2address).length, 1);
        assert.equal(resolver.get(name), address);
    });

    it('should remove a record from UNS', () => {
        const name = 'mytestname';
        const address = 0x121212121212;
        const resolver = contract.getUnsProviderResolver('ubix');
        resolver.add(name, address);

        assert.equal(Object.keys(contract._hash2address).length, 1);

        resolver.remove(name);

        assert.equal(Object.keys(contract._hash2address).length, 0);
    });

    it('should replace a record in UNS', () => {
        const oldName = 'mytestname';
        const newName = 'mybestname';
        const address = 0x121212121212;
        const resolver = contract.getUnsProviderResolver('ubix');
        resolver.add(oldName, address);

        assert.equal(resolver.get(oldName), address);

        resolver.replace(oldName, newName, address);

        assert.isNull(resolver.get(oldName));
        assert.equal(resolver.get(newName), address);
    });
});
