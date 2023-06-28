'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');

const {Ns: NsContract} = require('./ns');
const factory = require('../testFactory');
const {generateAddress, pseudoRandomBuffer} = require('../testUtil');

chai.use(require('chai-as-promised'));
const {assert} = chai;

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
        contract = new NsContract();
    });

    describe('check Ubix NS providers', async () => {
        it('should check default providers', async () => {
            const arrContractProviders = [...contract._providers].sort((a, b) => (a > b ? 1 : a === b ? 0 : -1));
            const arrProviders = ['email', 'tg', 'ig'].sort((a, b) => (a > b ? 1 : a === b ? 0 : -1));

            assert.deepEqual(arrContractProviders, arrProviders);
        });

        it('should add a provider', async () => {
            contract.addProvider('fb');
            const arrContractProviders = [...contract._providers].sort((a, b) => (a > b ? 1 : a === b ? 0 : -1));
            const arrProviders = ['email', 'tg', 'ig', 'fb'].sort((a, b) => (a > b ? 1 : a === b ? 0 : -1));

            assert.deepEqual(arrContractProviders, arrProviders);
        });
    });

    describe('create Ubix NS record', async () => {
        let arrData;

        beforeEach(async () => {
            global.value = 130000;
            arrData = ['tg', 'mytestname'];
        });

        it('should create', async () => {
            assert.equal(Object.keys(contract._ns).length, 0);

            await contract.create(...arrData);

            assert.equal(Object.keys(contract._ns).length, 1);

            await contract.verify(...arrData);

            assert.deepEqual(await contract.resolve('mytestname'), {[arrData[0]]: `Ux${callerAddress}`});
        });

        it('should throw (unsigned TX)', async () => {
            global.callerAddress = undefined;
            assert.isRejected(contract.create(...arrData), 'You should sign TX');
        });

        it('should throw (low create fee)', async () => {
            global.value = 130000 - 1;
            assert.isRejected(contract.create(...arrData), 'Update fee is 130000');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.isRejected(contract.create(null, 'mytestname'), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.isRejected(contract.create('tg', null), 'strName should be a string');
        });

        it('should throw (strProvider is not in the providers list)', async () => {
            assert.isRejected(contract.create('whatsapp', 'mytestname'), 'strProvider is not in the providers list');
        });

        it('should throw (create twice)', async () => {
            await contract.create(...arrData);

            assert.isRejected(contract.create(...arrData), 'Account has already defined');
        });
    });

    describe('remove Ubix NS record', async () => {
        let arrData;
        const strName = 'mytestname';

        beforeEach(async () => {
            global.value = 130000;
            arrData = ['tg', strName];
        });

        it('should remove', async () => {
            await contract.create(...arrData);

            assert.equal(Object.keys(contract._ns).length, 1);

            await contract.remove(...arrData.slice(0, 2));

            assert.equal(Object.keys(contract._ns).length, 0);
        });

        it('should throw (Account is not found)', async () => {
            assert.isRejected(contract.remove(...arrData.slice(0, 2)), 'Account is not found');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.isRejected(contract.remove(null, 'mytestname'), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.isRejected(contract.remove('tg', null), 'strName should be a string');
        });

        it('should throw (strProvider is not in the providers list)', async () => {
            assert.isRejected(contract.remove('whatsapp', 'mytestname'), 'strProvider is not in the providers list');
        });

        it('should throw (You are not the owner)', async () => {
            await contract.create(...arrData);

            global.callerAddress = generateAddress().toString('hex');

            assert.isRejected(contract.remove('tg', 'mytestname'), 'You are not the owner');
        });
    });

    describe('resolve Ubix NS record', async () => {
        let arrData;
        const strProvider = 'tg';
        const strName = 'mytestname';

        beforeEach(async () => {
            global.value = 130000;
            arrData = [strProvider, strName];

            await contract.create(...arrData);
            await contract.verify(...arrData);
        });

        it('should throw (Account is not found)', async () => {
            assert.isRejected(contract.resolve('NONAME'), 'Account is not found');
        });

        it('should throw (strName should be a string)', async () => {
            assert.isRejected(contract.resolve(null), 'strName should be a string');
        });

        it('should pass', async () => {
            const arrRecords = await contract.resolve(strName);

            assert.deepEqual(arrRecords, {
                [strProvider]: `Ux${callerAddress}`
            });
        });

        it('should resolve 2 records for the different providers', async () => {
            const arrDataNew = ['ig', strName];

            await contract.create(...arrDataNew);
            await contract.verify(...arrDataNew);

            const arrRecords = await contract.resolve(strName);

            assert.deepEqual(arrRecords, {
                [strProvider]: `Ux${callerAddress}`,
                ['ig']: `Ux${callerAddress}`
            });
        });
    });
});
