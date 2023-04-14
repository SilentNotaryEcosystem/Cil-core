'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
const sinon = require('sinon').createSandbox();
chai.use(require('chai-as-promised'));
const {assert} = chai;

const {DidNsV2: DidContract} = require('./didNsV2');

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
        global.call = sinon.fake();
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

            await contract.create(objData);

            assert.equal(Object.keys(contract._dids).length, 1);
        });

        it('should throw (unsigned TX)', async () => {
            global.callerAddress = undefined;
            assert.throws(() => contract.create(objData), 'You should sign TX');
        });

        it('should throw (low create fee)', async () => {
            global.value = 1000 - 1;
            assert.throws(() => contract.create(objData), 'Update fee is 1000');
        });

        it('should throw (DID document does not have Ubix NS keys)', async () => {
            assert.throws(
                () => contract.create({objDidDocument: {}, strIssuerName: 'Me'}),
                'DID document does not have Ubix NS keys'
            );
        });

        it('should throw (create twice)', async () => {
            await contract.create(objData);
            assert.throws(() => contract.create(objData), 'DID document hash has already defined');
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

        it('should remove', () => {
            contract.create(objData);

            assert.equal(Object.keys(contract._dids).length, 1);

            contract.remove('email', 'my-email@test.com');

            assert.equal(Object.keys(contract._dids).length, 0);
        });

        it('should throw (unsigned TX)', () => {
            const strDidAddress = contract.create(objData);

            global.callerAddress = undefined;

            assert.throws(() => contract.remove(strDidAddress), 'You should sign TX');
        });

        it('should throw (low create fee)', () => {
            const strDidAddress = contract.create(objData);

            global.value = 1000 - 1;

            assert.throws(() => contract.remove(strDidAddress), 'Update fee is 1000');
        });

        it('should throw (strProvider must be a string)', () => {
            assert.throws(() => contract.remove(null, null), 'strProvider should be a string');
        });

        it('should throw (strName must be a string)', () => {
            assert.throws(() => contract.remove('', null), 'strName should be a string');
        });

        it('should throw (Hash is not found)', () => {
            assert.throws(() => contract.remove('', ''), 'Hash is not found');
        });

        it('should fail (not owner)', async () => {
            contract.create(objData);

            callerAddress = generateAddress().toString('hex');

            assert.throws(() => contract.remove('email', 'my-email@test.com'), 'You are not the owner');
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

        it('should replace', () => {
            contract.create(objData);

            const strDidAddress = contract._resolveNs('email', 'my-email@test.com');

            assert.equal(Object.keys(contract._dids).length, 1);

            contract.replace('email', 'my-email@test.com', objNewData);

            assert.equal(Object.keys(contract._dids).length, 1);

            assert.equal(contract._dids[strDidAddress][1], 'Not me');
        });

        it('should throw (unsigned TX)', () => {
            contract.create(objData);

            global.callerAddress = undefined;

            assert.throws(() => contract.replace('email', 'my-email@test.com', objNewData), 'You should sign TX');
        });

        it('should throw (low create fee)', () => {
            contract.create(objData);

            const strDidAddress = contract._resolveNs('email', 'my-email@test.com');

            global.value = 1000 - 1;

            assert.throws(() => contract.replace(strDidAddress, objNewData), 'Update fee is 1000');
        });

        it('should replace (with merge)', async () => {
            contract.create(objData);

            const strDidAddress = contract._resolveNs('email', 'my-email@test.com');

            assert.equal(Object.keys(contract._dids).length, 1);

            await contract.replace('email', 'my-email@test.com', objNewData2);

            assert.equal(Object.keys(contract._dids).length, 1);

            assert.equal(contract._dids[strDidAddress][1], 'Not me');
        });

        it('should fail (not owner)', () => {
            contract.create(objData);

            callerAddress = generateAddress().toString('hex');

            assert.throws(() => contract.replace('email', 'my-email@test.com', objNewData), 'You are not the owner');
        });
    });
});
