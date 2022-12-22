'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const {Did: DidContract} = require('./did');
const factory = require('../../testFactory');
const {ADDRESS_TYPE, DID_PREFIX} = require('./constants');

const {generateAddress /*, pseudoRandomBuffer*/} = require('../../testUtil');

let contract;

describe('Did', () => {
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

        contract = new DidContract();
    });

    it('should create a new DID document', () => {
        const objDidDocument = {
            tg: 'my-tele-nick',
            email: 'my-email@test.com'
        };

        contract.create(objDidDocument);
        assert.equal(Object.keys(contract._didDocuments).length, 1);
    });

    it('should fail to create a new DID document', () => {
        const objDidDocument1 = {
            tg: 'my-tele-nick1',
            email: 'my-email@test.com'
        };

        const objDidDocument2 = {
            tg: 'my-tele-nick2',
            email: 'my-email@test.com'
        };

        contract.create(objDidDocument1);
        assert.throws(() => contract.create(objDidDocument2), 'Ubix NS hash has already defined!');
    });

    it('should remove a DID document', () => {
        const objDidDocument = {
            tg: 'my-tele-nick',
            email: 'my-email@test.com'
        };

        const strAddress = contract.create(objDidDocument);
        assert.equal(Object.keys(contract._didDocuments).length, 1);

        contract.remove(strAddress);
        assert.equal(Object.keys(contract._didDocuments).length, 0);
    });

    it('should replace a DID document', () => {
        const objDidDocument = {
            tg: 'my-tele-nick',
            email: 'my-email@test.com'
        };

        const objNewDidDocument = {
            tg: 'my-tele-new-nick',
            email: 'my-email@test.com'
        };

        const strAddress = contract.create(objDidDocument);
        assert.equal(Object.keys(contract._didDocuments).length, 1);

        contract.replace(strAddress, objNewDidDocument);
        assert.equal(Object.keys(contract._didDocuments).length, 1);
    });

    it('should get UNS address in 3 different formats', () => {
        const objDidDocument = {
            // id: `did:ubix:${address}`, // TODO: make it calculated field
            tg: 'my-tele-nick',
            email: 'my-email@test.com'
        };

        const strAddress = contract.create(objDidDocument);

        assert.equal(Object.keys(contract._didDocuments).length, 1);

        assert.equal(Object.keys(contract.Uns._hash2address).length, 2);
        assert.equal(contract.getData(strAddress), strAddress);
        assert.equal(contract.getData(strAddress, ADDRESS_TYPE.DID_ID), `${DID_PREFIX}:${strAddress}`);
        assert.equal(
            JSON.stringify(contract.getData(strAddress, ADDRESS_TYPE.DID_DOCUMENT)),
            JSON.stringify(objDidDocument)
        );
    });
});
