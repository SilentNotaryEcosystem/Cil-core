'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const {DidV1Test5: DidContract} = require('./didNsV1');

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
            assert.equal(Object.keys(contract._ns).length, 0);

            contract.createNs(objUnsData);

            assert.equal(Object.keys(contract._ns).length, 1);
            assert.equal(contract.resolveNs(objUnsData.strProvider, objUnsData.strName), objUnsData.strDidAddress);
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.throws(
                () => contract.createNs({...objUnsData, strProvider: null}),
                'strProvider should be a string'
            );
        });

        it('should throw (strName should be a string)', async () => {
            assert.throws(() => contract.createNs({...objUnsData, strName: null}), 'strName should be a string');
        });

        it('should throw (strAddress should be a string)', async () => {
            assert.throws(
                () => contract.createNs({...objUnsData, strDidAddress: null}),
                'strDidAddress should be a string'
            );
        });

        it('should throw (create twice)', async () => {
            contract.createNs(objUnsData);
            assert.throws(() => contract.createNs(objUnsData), 'Hash has already defined');
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
            contract.createNs(objUnsData);

            assert.equal(Object.keys(contract._ns).length, 1);
            contract.removeNs(objUnsData);
            assert.equal(Object.keys(contract._ns).length, 0);
        });

        it('should throw (Hash is not found)', async () => {
            assert.throws(() => contract.removeNs(objUnsData), 'Hash is not found');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.throws(
                () => contract.removeNs({...objUnsData, strProvider: null}),
                'strProvider should be a string'
            );
        });

        it('should throw (strName should be a string)', async () => {
            assert.throws(() => contract.removeNs({...objUnsData, strName: null}), 'strName should be a string');
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

            contract.createNs(objUnsData);
        });

        it('should throw (Hash is not found)', async () => {
            assert.throws(() => contract.resolveNs('NO', 'NAME'), 'Hash is not found');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.throws(() => contract.resolveNs(null, objUnsData.strName), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.throws(() => contract.resolveNs(objUnsData.strProvider, null), 'strName should be a string');
        });

        it('should pass', async () => {
            const strDidAddress = contract.resolveNs(objUnsData.strProvider, objUnsData.strName);

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

            contract.createBatchNs(keyMap);
            assert.equal(Object.keys(contract._ns).length, Object.keys(objDidDocument).length);
        });

        it('should throw (Must be a Map instance)', () => {
            assert.throws(() => contract.createBatchNs(null), 'Must be a Map instance');
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

            assert.throws(() => contract.createBatchNs(keyMap), 'strName should be a string');
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

            assert.throws(() => contract.createBatchNs(keyMap), 'strDidAddress should be a string');
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

            contract.createBatchNs(keyMap);
            assert.throws(() => contract.createBatchNs(keyMap), 'Hash has already defined');
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

            contract.createBatchNs(keyMap);
            assert.equal(Object.keys(contract._ns).length, Object.keys(objDidDocument).length);
            contract.removeBatchNs(keyMap);
            assert.equal(Object.keys(contract._ns).length, 0);
        });

        it('should throw (Must be a Map instance)', () => {
            const strAddress = 0x121212121212;
            assert.throws(() => contract.removeBatchNs({}, strAddress), 'Must be a Map instance');
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

            contract.createBatchNs(keyMap);
            assert.throws(() => contract.removeBatchNs(keyMap2), 'strName should be a string');
        });
    });
});
