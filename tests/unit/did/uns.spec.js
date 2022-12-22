'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const {Uns: UnsContract} = require('./uns');
const factory = require('../../testFactory');

const {generateAddress /*, pseudoRandomBuffer*/} = require('../../testUtil');

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
        global.callerAddress = generateAddress().toString('hex');
        // global.contractTx = pseudoRandomBuffer().toString('hex');
        // global.block = {
        //     height: 100,
        //     hash: 'hash'
        // };

        contract = new UnsContract();
    });

    it('should create a new UNS record', () => {
        const provider = 'ubix';
        const name = 'mytestname';
        const address = 0x121212121212;

        assert.equal(Object.keys(contract._hash2address).length, 0);

        contract.create(provider, name, address);

        assert.equal(Object.keys(contract._hash2address).length, 1);
        assert.equal(contract.get(provider, name), address);
    });

    it('should remove an UNS record', () => {
        const provider = 'ubix';
        const name = 'mytestname';
        const address = 0x121212121212;

        contract.create(provider, name, address);

        assert.equal(Object.keys(contract._hash2address).length, 1);

        contract.remove(provider, name);

        assert.equal(Object.keys(contract._hash2address).length, 0);
    });

    it('should fail at creating the same UNS record', () => {
        const provider = 'ubix';
        const name = 'mytestname';
        const address = 0x121212121212;

        contract.create(provider, name, address);
        assert.throws(() => contract.create(provider, name, address), 'Hash has already defined!');
    });

    it('should create UNS records from DID document in a batch mode', () => {
        const objDidDocument = {
            ubix: 'my_ubix_nick',
            email: 'my@best.mail',
            tg: 'john_doe'
        };
        const strAddress = 0x121212121212;

        contract.createBatch(objDidDocument, strAddress);
        assert.equal(Object.keys(contract._hash2address).length, Object.keys(objDidDocument).length);
    });

    it('should fail create UNS records from DID document in a batch mode', () => {
        const strAddress = 0x121212121212;

        assert.throws(() => contract.createBatch({}, strAddress), 'DID document does not have UNS keys');
    });

    it('should remove UNS records from DID document in a batch mode', () => {
        const objDidDocument = {
            ubix: 'my_ubix_nick',
            email: 'my@best.mail',
            tg: 'john_doe'
        };
        const strAddress = 0x121212121212;

        contract.createBatch(objDidDocument, strAddress);
        assert.equal(Object.keys(contract._hash2address).length, Object.keys(objDidDocument).length);

        contract.removeBatch(objDidDocument, strAddress);
        assert.equal(Object.keys(contract._hash2address).length, 0);
    });

    it('should fail remove UNS records from DID document in a batch mode', () => {
        const strAddress = 0x121212121212;

        assert.throws(() => contract.removeBatch({}, strAddress), 'DID document does not have UNS keys');
    });
});
