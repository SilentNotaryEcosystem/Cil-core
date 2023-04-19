'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const {DidNsV2: DidContract} = require('./didNsV2');

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
            assert.equal(Object.keys(contract._ns).length, 0);

            contract._createNs(objData);

            assert.equal(Object.keys(contract._ns).length, 1);
            assert.equal(contract._resolveNs(objData.strProvider, objData.strName), objData.strDidAddress);
        });

        it('should throw (unsigned TX)', async () => {
            global.callerAddress = undefined;
            assert.throws(() => contract._createNs(objData), 'You should sign TX');
        });

        it('should throw (low create fee)', async () => {
            global.value = 1e3 - 1;
            assert.throws(() => contract._createNs(objData), 'Update fee is 1000');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.throws(() => contract._createNs({...objData, strProvider: null}), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.throws(() => contract._createNs({...objData, strName: null}), 'strName should be a string');
        });

        it('should throw (strAddress should be a string)', async () => {
            assert.throws(
                () => contract._createNs({...objData, strDidAddress: null}),
                'strDidAddress should be a string'
            );
        });

        it('should throw (create twice)', async () => {
            contract._createNs(objData);
            assert.throws(() => contract._createNs(objData), 'Hash has already defined');
        });
    });

    describe('remove Ubix NS record', async () => {
        let objData;

        beforeEach(async () => {
            global.value = 1000;

            objData = {
                strProvider: 'ubix',
                strName: 'mytestname',
                strDidAddress: '0x121212121212'
            };
        });

        it('should remove', async () => {
            contract._createNs(objData);

            assert.equal(Object.keys(contract._ns).length, 1);
            contract._removeNs(objData);
            assert.equal(Object.keys(contract._ns).length, 0);
        });

        it('should throw (Hash is not found)', async () => {
            assert.throws(() => contract._removeNs(objData), 'Hash is not found');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.throws(() => contract._removeNs({...objData, strProvider: null}), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.throws(() => contract._removeNs({...objData, strName: null}), 'strName should be a string');
        });
    });

    describe('resolve Ubix NS record', async () => {
        let objData;

        beforeEach(async () => {
            global.value = 1000;

            objData = {
                strProvider: 'ubix',
                strName: 'mytestname',
                strDidAddress: '0x121212121212'
            };

            contract._createNs(objData);
        });

        it('should throw (Hash is not found)', async () => {
            assert.throws(() => contract._resolveNs('NO', 'NAME'), 'Hash is not found');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.throws(() => contract._resolveNs(null, objData.strName), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.throws(() => contract._resolveNs(objData.strProvider, null), 'strName should be a string');
        });

        it('should pass', async () => {
            const strDidAddress = contract._resolveNs(objData.strProvider, objData.strName);

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
                strDidAddress: '0x121212121212'
            };

            contract._createBatchNs(objData);
            assert.equal(Object.keys(contract._ns).length, Object.keys(objData.objDidDocument).length);
        });

        it('should throw (Must be an Object instance)', () => {
            assert.throws(() => contract._createBatchNs(null), 'Must be an Object instance');
        });

        it('should throw (strName should be a string)', async () => {
            const objData = {
                objDidDocument: {
                    ubix: null,
                    email: 'my@best.mail',
                    tg: 'john_doe'
                },
                strDidAddress: '0x121212121212'
            };

            assert.throws(() => contract._createBatchNs(objData), 'strName should be a string');
        });

        it('should throw (strAddress should be a string)', async () => {
            const objData = {
                objDidDocument: {
                    ubix: 'my_ubix_nick',
                    email: 'my@best.mail',
                    tg: 'john_doe'
                },
                strDidAddress: null
            };

            assert.throws(() => contract._createBatchNs(objData), 'strDidAddress should be a string');
        });

        it('should throw (create twice)', async () => {
            const objData = {
                objDidDocument: {
                    ubix: 'my_ubix_nick',
                    email: 'my@best.mail',
                    tg: 'john_doe'
                },
                strDidAddress: '0x121212121212'
            };

            contract._createBatchNs(objData);
            assert.throws(() => contract._createBatchNs(objData), 'Hash has already defined');
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
                strDidAddress: '0x121212121212'
            };

            contract._createBatchNs(objData);
            assert.equal(Object.keys(contract._ns).length, Object.keys(objData.objDidDocument).length);
            contract._removeBatchNs(objData);
            assert.equal(Object.keys(contract._ns).length, 0);
        });

        it('should throw (Must be an Object instance)', () => {
            const strAddress = 0x121212121212;
            assert.throws(() => contract._removeBatchNs(null, strAddress), 'Must be an Object instance');
        });

        it('should throw (DID document be an Object instance)', () => {
            const strAddress = 0x121212121212;
            assert.throws(() => contract._removeBatchNs({}, strAddress), 'DID document be an Object instance');
        });
    });

    describe('replace Ubix NS records in a batch mode', async () => {
        let objOldData, objNewData, objNewData2;
        beforeEach(async () => {
            global.value = 1000;

            objOldData = {
                objDidDocument: {
                    ubix: 'my_ubix_nick',
                    email: 'my@best.mail',
                    tg: 'john_doe'
                },
                strDidAddress: '0x121212121212'
            };

            objNewData = {
                objDidDocument: {
                    ubix: 'my_ubix_nick_new',
                    email: 'my_new@best.mail',
                    tg: 'jack_doe'
                },
                strDidAddress: '0x121212121212'
            };

            objNewData2 = {
                objDidDocument: {
                    ubix: 'my_ubix_nick_new',
                    ig: 'jack_doe'
                },
                strDidAddress: '0x121212121212'
            };
        });

        it('should replace', () => {
            contract._createBatchNs(objOldData);
            assert.equal(Object.keys(contract._ns).length, Object.keys(objOldData.objDidDocument).length);

            contract._replaceBatchNs(objOldData, objNewData);

            const strDidAddress = contract._resolveNs('email', objNewData.objDidDocument.email);

            assert.isOk(strDidAddress);
        });

        it('should throw (Must be an Object instance)', () => {
            assert.throws(() => contract._replaceBatchNs(null, objNewData), 'Must be an Object instance');
            assert.throws(() => contract._replaceBatchNs(objOldData, null), 'Must be an Object instance');
        });

        it('should throw (DID document be an Object instance)', () => {
            assert.throws(() => contract._replaceBatchNs({}, objNewData), 'DID document be an Object instance');
            assert.throws(() => contract._replaceBatchNs(objOldData, {}), 'DID document be an Object instance');
        });

        it('should replace (with merge)', async () => {
            contract._createBatchNs(objOldData);
            contract._replaceBatchNs(objOldData, objNewData2);

            const strDidAddress = contract._resolveNs('ig', objNewData2.objDidDocument.ig);

            assert.isOk(strDidAddress);
        });
    });
});
