'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const {DidV1Test4: DidContract} = require('./didNsV1');

const factory = require('../../testFactory');

const {generateAddress, pseudoRandomBuffer} = require('../../testUtil');

let didContract, contract;

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
        didContract = new DidContract();
        contract = didContract._ns;
    });

    describe('create Ubix NS record', async () => {
        let objUnsData;

        beforeEach(async () => {
            global.value = 130000;
            objUnsData = {
                strProvider: 'ubix',
                strName: 'mytestname',
                strIssuerName: 'Me',
                strDidAddress: '0x121212121212'
            };
        });

        it('should create', async () => {
            assert.equal(Object.keys(contract._data).length, 0);

            contract.create(objUnsData);

            assert.equal(Object.keys(contract._data).length, 1);
            assert.equal(contract.resolve(objUnsData.strProvider, objUnsData.strName), objUnsData.strDidAddress);
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.throws(() => contract.create({...objUnsData, strProvider: null}), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.throws(() => contract.create({...objUnsData, strName: null}), 'strName should be a string');
        });

        it('should throw (strAddress should be a string)', async () => {
            assert.throws(
                () => contract.create({...objUnsData, strDidAddress: null}),
                'strDidAddress should be a string'
            );
        });

        it('should throw (create twice)', async () => {
            contract.create(objUnsData);
            assert.throws(() => contract.create(objUnsData), 'Hash has already defined');
        });
    });

    describe('remove Ubix NS record', async () => {
        let objUnsData;

        beforeEach(async () => {
            global.value = 130000;

            objUnsData = {
                strProvider: 'ubix',
                strName: 'mytestname',
                strIssuerName: 'Me',
                strDidAddress: '0x121212121212'
            };
        });

        it('should remove', async () => {
            contract.create(objUnsData);

            assert.equal(Object.keys(contract._data).length, 1);
            contract.remove(objUnsData);
            assert.equal(Object.keys(contract._data).length, 0);
        });

        it('should throw (Hash is not found)', async () => {
            assert.throws(() => contract.remove(objUnsData), 'Hash is not found');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.throws(() => contract.remove({...objUnsData, strProvider: null}), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.throws(() => contract.remove({...objUnsData, strName: null}), 'strName should be a string');
        });
    });

    describe('resolve Ubix NS record', async () => {
        let objUnsData;

        beforeEach(async () => {
            global.value = 130000;

            objUnsData = {
                strProvider: 'ubix',
                strName: 'mytestname',
                strIssuerName: 'Me',
                strDidAddress: '0x121212121212'
            };

            contract.create(objUnsData);
        });

        it('should throw (Hash is not found)', async () => {
            assert.throws(() => contract.resolve('NO', 'NAME'), 'Hash is not found');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.throws(() => contract.resolve(null, objUnsData.strName), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.throws(() => contract.resolve(objUnsData.strProvider, null), 'strName should be a string');
        });

        it('should pass', async () => {
            const strDidAddress = contract.resolve(objUnsData.strProvider, objUnsData.strName);

            assert.isOk(strDidAddress);
        });
    });

    describe('create Ubix NS records in a batch mode', async () => {
        beforeEach(async () => {
            global.value = 130000;
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
            global.value = 130000;
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
