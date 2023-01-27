'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const {DidV1Test1: DidContract} = require('./didNsV1');

const factory = require('../../testFactory');

const {generateAddress} = require('../../testUtil');

let contract;

describe('Ubix DID', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function () {
        // this.timeout(15000);
    });

    beforeEach(async () => {
        global.value = 0;
        global.callerAddress = generateAddress().toString('hex');
        global.createHash = str => factory.Crypto.createHash(str);
        contract = new DidContract();
    });

    describe('create DID document', async () => {
        let objData;

        beforeEach(async () => {
            global.value = 130000;

            objData = {
                objDidDocument: {
                    tg: 'my-tele-nick',
                    email: 'my-email@test.com'
                },
                strIssuerName: 'Me'
            };
        });

        it('should create', async () => {
            assert.equal(Object.keys(contract._dids).length, 0);

            contract.create(objData);

            assert.equal(Object.keys(contract._dids).length, 1);
        });

        it('should throw (unsigned TX)', async () => {
            global.callerAddress = undefined;
            assert.throws(() => contract.create(objData), 'You should sign TX');
        });

        it('should throw (low create fee)', async () => {
            global.value = 130000 - 1;
            assert.throws(() => contract.create(objData), 'Update fee is 130000');
        });

        it('should throw (DID document does not have Ubix NS keys)', async () => {
            assert.throws(
                () => contract.create({objDidDocument: {}, strIssuerName: 'Me'}),
                'DID document does not have Ubix NS keys'
            );
        });

        it('should throw (create twice)', async () => {
            contract.create(objData);
            assert.throws(() => contract.create(objData), 'Hash has already defined');
        });
    });

    describe('remove DID document', async () => {
        let objData;

        beforeEach(async () => {
            global.value = 130000;

            objData = {
                objDidDocument: {
                    tg: 'my-tele-nick',
                    email: 'my-email@test.com'
                },
                strIssuerName: 'Me'
            };
        });

        it('should remove', async () => {
            const strDidAddress = contract.create(objData);

            assert.equal(Object.keys(contract._dids).length, 1);

            contract.remove(strDidAddress);

            assert.equal(Object.keys(contract._dids).length, 0);
        });

        it('should throw (strDidAddress must be a string)', async () => {
            assert.throws(() => contract.remove(null), 'strDidAddress should be a string');
        });

        it('should throw (Hash is not found)', async () => {
            assert.throws(() => contract.remove(''), 'Hash is not found');
        });

        it('should fail (not owner)', async () => {
            const strDidAddress = contract.create(objData);

            callerAddress = generateAddress().toString('hex');

            assert.throws(() => contract.remove(strDidAddress), 'You are not the owner');
        });
    });

    describe('replace Ubix NS record', async () => {
        let objData, objNewData, objNewData2;

        beforeEach(async () => {
            global.value = 130000;

            objData = {
                objDidDocument: {
                    tg: 'my-tele-nick',
                    email: 'my-email@test.com'
                },
                strIssuerName: 'Me'
            };

            objNewData = {
                objDidDocument: {
                    tg: 'new-tele-nick',
                    email: 'new-email@test.com'
                },
                strIssuerName: 'Not me'
            };

            objNewData2 = {
                objDidDocument: {
                    tg: 'my-tele-nick',
                    email: 'new-email@test.com'
                },
                strIssuerName: 'Not me'
            };
        });

        it('should replace', async () => {
            const strDidAddress = contract.create(objData);

            assert.equal(Object.keys(contract._dids).length, 1);

            contract.replace(strDidAddress, objNewData);

            assert.equal(Object.keys(contract._dids).length, 1);

            assert.equal(contract._dids[strDidAddress].strIssuerName, 'Not me');
        });

        it('should replace (with merge)', async () => {
            const strDidAddress = contract.create(objData);

            assert.equal(Object.keys(contract._dids).length, 1);

            contract.replace(strDidAddress, objNewData2);

            assert.equal(Object.keys(contract._dids).length, 1);

            assert.equal(contract._dids[strDidAddress].strIssuerName, 'Not me');
        });

        it('should throw (strDidAddress must be a string)', async () => {
            assert.throws(() => contract.remove(null), 'strDidAddress should be a string');
        });

        it('should throw (Hash is not found)', async () => {
            assert.throws(() => contract.remove(''), 'Hash is not found');
        });

        it('should fail (not owner)', async () => {
            const strDidAddress = contract.create(objData);

            callerAddress = generateAddress().toString('hex');

            assert.throws(() => contract.replace(strDidAddress, objNewData), 'You are not the owner');
        });
    });
});
