'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const {NsV1Test1: DidContract} = require('./nsV1');

const factory = require('../../testFactory');

const {generateAddress, pseudoRandomBuffer} = require('../../testUtil');

let contract;

describe('Ubix NS', () => {
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
        global.contractTx = pseudoRandomBuffer().toString('hex');
        global.createHash = str => factory.Crypto.createHash(str);
        contract = new DidContract();
    });

    describe('create Ubix NS record', async () => {
        let objData;

        beforeEach(async () => {
            global.value = 1000;

            objData = {
                strProvider: 'ubix',
                strName: 'mytestname',
                strIssuerName: 'Me',
                strDidAddress: '0x121212121212'
            };
        });

        it('should create', async () => {
            assert.equal(Object.keys(contract._data).length, 0);

            contract.create(objData);

            assert.equal(Object.keys(contract._data).length, 1);
            assert.equal(contract.resolve(objData.strProvider, objData.strName), objData.strDidAddress);
        });

        it('should throw (unsigned TX)', async () => {
            global.callerAddress = undefined;
            assert.throws(() => contract.create(objData), 'You should sign TX');
        });

        it('should throw (low create fee)', async () => {
            global.value = 1e3 - 1;
            assert.throws(() => contract.create(objData), 'Update fee is 1000');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.throws(() => contract.create({...objData, strProvider: null}), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.throws(() => contract.create({...objData, strName: null}), 'strName should be a string');
        });

        it('should throw (strAddress should be a string)', async () => {
            assert.throws(() => contract.create({...objData, strDidAddress: null}), 'strDidAddress should be a string');
        });

        it('should throw (create twice)', async () => {
            contract.create(objData);
            assert.throws(() => contract.create(objData), 'Hash has already defined');
        });
    });

    describe('remove Ubix NS record', async () => {
        let objData;

        beforeEach(async () => {
            global.value = 1000;

            objData = {
                strProvider: 'ubix',
                strName: 'mytestname',
                strIssuerName: 'Me',
                strDidAddress: '0x121212121212'
            };
        });

        it('should remove', async () => {
            contract.create(objData);

            assert.equal(Object.keys(contract._data).length, 1);
            contract.remove(objData);
            assert.equal(Object.keys(contract._data).length, 0);
        });

        it('should throw (Hash is not found)', async () => {
            assert.throws(() => contract.remove(objData), 'Hash is not found');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.throws(() => contract.remove({...objData, strProvider: null}), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.throws(() => contract.remove({...objData, strName: null}), 'strName should be a string');
        });
    });

    describe('resolve Ubix NS record', async () => {
        let objData;

        beforeEach(async () => {
            global.value = 1000;

            objData = {
                strProvider: 'ubix',
                strName: 'mytestname',
                strIssuerName: 'Me',
                strDidAddress: '0x121212121212'
            };

            contract.create(objData);
        });

        it('should throw (Hash is not found)', async () => {
            assert.throws(() => contract.resolve('NO', 'NAME'), 'Hash is not found');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.throws(() => contract.resolve(null, objData.strName), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.throws(() => contract.resolve(objData.strProvider, null), 'strName should be a string');
        });

        it('should pass', async () => {
            const strDidAddress = contract.resolve(objData.strProvider, objData.strName);

            assert.isOk(strDidAddress);
        });
    });

    describe('create Ubix NS records in a batch mode', async () => {
        beforeEach(async () => {
            global.value = 1000;
        });

        it('should create', () => {
            const objData = {
                objDidDocument: {
                    ubix: 'my_ubix_nick',
                    email: 'my@best.mail',
                    tg: 'john_doe'
                },
                strIssuerName: 'Me',
                strDidAddress: '0x121212121212'
            };

            contract.createBatch(objData);
            assert.equal(Object.keys(contract._data).length, Object.keys(objData.objDidDocument).length);
        });

        it('should throw (Must be a Map instance)', () => {
            assert.throws(() => contract.createBatch(null), 'Must be an Object instance');
        });

        it('should throw (strName should be a string)', async () => {
            const objData = {
                objDidDocument: {
                    ubix: null,
                    email: 'my@best.mail',
                    tg: 'john_doe'
                },
                strIssuerName: 'Me',
                strDidAddress: '0x121212121212'
            };

            assert.throws(() => contract.createBatch(objData), 'strName should be a string');
        });

        it('should throw (strAddress should be a string)', async () => {
            const objData = {
                objDidDocument: {
                    ubix: 'my_ubix_nick',
                    email: 'my@best.mail',
                    tg: 'john_doe'
                },
                strIssuerName: 'Me',
                strDidAddress: null
            };

            assert.throws(() => contract.createBatch(objData), 'strDidAddress should be a string');
        });

        it('should throw (create twice)', async () => {
            const objData = {
                objDidDocument: {
                    ubix: 'my_ubix_nick',
                    email: 'my@best.mail',
                    tg: 'john_doe'
                },
                strIssuerName: 'Me',
                strDidAddress: '0x121212121212'
            };

            contract.createBatch(objData);
            assert.throws(() => contract.createBatch(objData), 'Hash has already defined');
        });
    });

    describe('remove Ubix NS records in a batch mode', async () => {
        beforeEach(async () => {
            global.value = 1000;
        });

        it('should remove', () => {
            const objData = {
                objDidDocument: {
                    ubix: 'my_ubix_nick',
                    email: 'my@best.mail',
                    tg: 'john_doe'
                },
                strIssuerName: 'Me',
                strDidAddress: '0x121212121212'
            };

            contract.createBatch(objData);
            assert.equal(Object.keys(contract._data).length, Object.keys(objData.objDidDocument).length);
            contract.removeBatch(objData);
            assert.equal(Object.keys(contract._data).length, 0);
        });

        it('should throw (Must be a Map instance)', () => {
            const strAddress = 0x121212121212;
            assert.throws(() => contract.removeBatch(null, strAddress), 'Must be an Object instance');
        });

        it('should throw (Must be a Map instance)', () => {
            const strAddress = 0x121212121212;
            assert.throws(() => contract.removeBatch({}, strAddress), 'DID document be an Object instance');
        });

        it('should throw (strName should be a string)', async () => {
            const objData = {
                objDidDocument: {
                    ubix: 'my_ubix_nick',
                    email: 'my@best.mail',
                    tg: 'john_doe'
                },
                strIssuerName: 'Me',
                strDidAddress: '0x121212121212'
            };

            const objData2 = {
                objDidDocument: {
                    ubix: 'my_ubix_nick',
                    email: null,
                    tg: 'john_doe'
                },
                strIssuerName: 'Me',
                strDidAddress: '0x121212121212'
            };

            contract.createBatch(objData);
            assert.throws(() => contract.removeBatch(objData2), 'strName should be a string');
        });
    });
});
