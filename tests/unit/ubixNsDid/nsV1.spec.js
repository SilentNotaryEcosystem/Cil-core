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
            const objDidDocument = {
                ubix: 'my_ubix_nick',
                email: 'my@best.mail',
                tg: 'john_doe'
            };
            const strIssuerName = 'Me';
            const strDidAddress = '0x121212121212';

            const keyMap = new Map(
                Object.entries(objDidDocument).map(([strProvider, strName]) => [
                    strProvider,
                    {
                        strName,
                        strIssuerName,
                        strDidAddress
                    }
                ])
            );

            contract.createBatch(keyMap);
            assert.equal(Object.keys(contract._data).length, Object.keys(objDidDocument).length);
        });

        it('should throw (Must be a Map instance)', () => {
            assert.throws(() => contract.createBatch(null), 'Must be a Map instance');
        });

        it('should throw (strName should be a string)', async () => {
            const objDidDocument = {
                ubix: null,
                email: 'my@best.mail',
                tg: 'john_doe'
            };
            const strIssuerName = 'Me';
            const strDidAddress = '0x121212121212';

            const keyMap = new Map(
                Object.entries(objDidDocument).map(([strProvider, strName]) => [
                    strProvider,
                    {
                        strName,
                        strIssuerName,
                        strDidAddress
                    }
                ])
            );

            assert.throws(() => contract.createBatch(keyMap), 'strName should be a string');
        });

        it('should throw (strAddress should be a string)', async () => {
            const objDidDocument = {
                ubix: 'my_ubix_nick',
                email: 'my@best.mail',
                tg: 'john_doe'
            };
            const strIssuerName = 'Me';
            const strDidAddress = null;

            const keyMap = new Map(
                Object.entries(objDidDocument).map(([strProvider, strName]) => [
                    strProvider,
                    {
                        strName,
                        strIssuerName,
                        strDidAddress
                    }
                ])
            );

            assert.throws(() => contract.createBatch(keyMap), 'strDidAddress should be a string');
        });

        it('should throw (create twice)', async () => {
            const objDidDocument = {
                ubix: 'my_ubix_nick',
                email: 'my@best.mail',
                tg: 'john_doe'
            };
            const strIssuerName = 'Me';
            const strDidAddress = '0x121212121212';

            const keyMap = new Map(
                Object.entries(objDidDocument).map(([strProvider, strName]) => [
                    strProvider,
                    {
                        strName,
                        strIssuerName,
                        strDidAddress
                    }
                ])
            );

            contract.createBatch(keyMap);
            assert.throws(() => contract.createBatch(keyMap), 'Hash has already defined');
        });
    });

    describe('remove Ubix NS records in a batch mode', async () => {
        beforeEach(async () => {
            global.value = 1000;
        });

        it('should remove', () => {
            const objDidDocument = {
                ubix: 'my_ubix_nick',
                email: 'my@best.mail',
                tg: 'john_doe'
            };
            const strIssuerName = 'Me';
            const strDidAddress = '0x121212121212';

            const keyMap = new Map(
                Object.entries(objDidDocument).map(([strProvider, strName]) => [
                    strProvider,
                    {
                        strName,
                        strIssuerName,
                        strDidAddress
                    }
                ])
            );

            contract.createBatch(keyMap);
            assert.equal(Object.keys(contract._data).length, Object.keys(objDidDocument).length);
            contract.removeBatch(keyMap);
            assert.equal(Object.keys(contract._data).length, 0);
        });

        it('should throw (Must be a Map instance)', () => {
            const strAddress = 0x121212121212;
            assert.throws(() => contract.removeBatch({}, strAddress), 'Must be a Map instance');
        });

        it('should throw (strName should be a string)', async () => {
            const objDidDocument = {
                ubix: 'my_ubix_nick',
                email: 'my@best.mail',
                tg: 'john_doe'
            };

            const objDidDocument2 = {
                ubix: 'my_ubix_nick',
                email: null,
                tg: 'john_doe'
            };

            const strIssuerName = 'Me';
            const strDidAddress = '0x121212121212';

            const keyMap = new Map(
                Object.entries(objDidDocument).map(([strProvider, strName]) => [
                    strProvider,
                    {
                        strName,
                        strIssuerName,
                        strDidAddress
                    }
                ])
            );

            const keyMap2 = new Map(
                Object.entries(objDidDocument2).map(([strProvider, strName]) => [
                    strProvider,
                    {
                        strName,
                        strIssuerName,
                        strDidAddress
                    }
                ])
            );

            contract.createBatch(keyMap);
            assert.throws(() => contract.removeBatch(keyMap2), 'strName should be a string');
        });
    });
});
