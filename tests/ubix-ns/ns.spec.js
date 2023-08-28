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

        it('should create (not confirmed)', async () => {
            assert.equal(Object.keys(contract._ns).length, 0);

            await contract.create(...arrData);

            assert.equal(Object.keys(contract._ns).length, 1);
            assert.deepEqual(await contract.resolve('mytestname', false), {
                [arrData[0]]: [global.callerAddress, false]
            });
            assert.isRejected(contract.resolve('mytestname'), 'Account is not found');
        });

        it('should create (by not a contract owner)', async () => {
            assert.equal(Object.keys(contract._ns).length, 0);

            global.callerAddress = generateAddress().toString('hex');
            await contract.create(...arrData);

            assert.equal(Object.keys(contract._ns).length, 1);
            assert.deepEqual(await contract.resolve('mytestname', false), {
                [arrData[0]]: [global.callerAddress, false]
            });
            assert.isRejected(contract.resolve('mytestname'), 'Account is not found');
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
            await contract.confirm(...arrData);
            assert.isRejected(contract.create(...arrData), 'Account has already defined');
        });

        it('should not throw create twice for not confirmed account', async () => {
            await contract.create(...arrData);
            await contract.create(...arrData);

            assert.equal(Object.keys(contract._ns).length, 1);
            assert.deepEqual(await contract.resolve('mytestname', false), {
                [arrData[0]]: [global.callerAddress, false]
            });
        });

        it('should not throw create twice for not confirmed account (different user)', async () => {
            await contract.create(...arrData);

            assert.deepEqual(await contract.resolve('mytestname', false), {
                [arrData[0]]: [global.callerAddress, false]
            });

            const strFirstCallerAddress = global.callerAddress;
            global.callerAddress = generateAddress().toString('hex');

            await contract.create(...arrData);

            assert.notDeepEqual(await contract.resolve('mytestname', false), {
                [arrData[0]]: [strFirstCallerAddress, false]
            });

            assert.deepEqual(await contract.resolve('mytestname', false), {
                [arrData[0]]: [global.callerAddress, false]
            });
        });
    });

    describe('create and confirm Ubix NS record', async () => {
        let arrData;

        beforeEach(async () => {
            global.value = 130000;
            arrData = ['tg', 'mytestname'];

            await contract.create(...arrData);
        });

        it('should confirm', async () => {
            await contract.confirm(...arrData);

            assert.deepEqual(await contract.resolve('mytestname'), {[arrData[0]]: global.callerAddress});
        });

        it('should create (by not a contract owner) and confirm ', async () => {
            const arrData = ['tg', 'newtestname'];

            const strOwnerAddress = global.callerAddress;
            const strUserAddress = generateAddress().toString('hex');
            global.callerAddress = strUserAddress;

            await contract.create(...arrData);

            global.callerAddress = strOwnerAddress;
            await contract.confirm(...arrData);

            assert.deepEqual(await contract.resolve('newtestname'), {[arrData[0]]: strUserAddress});
        });

        it('should throw (unsigned TX)', async () => {
            global.callerAddress = undefined;
            assert.isRejected(contract.confirm(...arrData), 'You should sign TX');
        });

        it('should try to confirm not by the contract owner', async () => {
            global.callerAddress = generateAddress().toString('hex');
            assert.isRejected(contract.confirm(...arrData), 'Unauthorized call');
        });

        it('should throw (low create fee)', async () => {
            global.value = 130000 - 1;
            assert.isRejected(contract.confirm(...arrData), 'Update fee is 130000');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.isRejected(contract.create(null, 'mytestname'), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.isRejected(contract.confirm('tg', null), 'strName should be a string');
        });

        it('should throw (strProvider is not in the providers list)', async () => {
            assert.isRejected(contract.confirm('whatsapp', 'mytestname'), 'strProvider is not in the providers list');
        });

        it('should throw (account is not found)', async () => {
            assert.isRejected(contract.confirm('tg', 'noname'), 'Account is not found');
        });

        it('should throw (confirmed twice)', async () => {
            await contract.confirm(...arrData);

            assert.isRejected(contract.confirm(...arrData), 'Account has already defined');
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

        it('should throw (account is not found)', async () => {
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
            await contract.confirm(...arrData);
        });

        it('should throw (account is not found)', async () => {
            assert.isRejected(contract.resolve('NONAME'), 'Account is not found');
        });

        it('should throw (strName should be a string)', async () => {
            assert.isRejected(contract.resolve(null), 'strName should be a string');
        });

        it('should pass', async () => {
            const arrRecords = await contract.resolve(strName);

            assert.deepEqual(arrRecords, {
                [strProvider]: global.callerAddress
            });
        });

        it('should resolve 2 records for the different providers', async () => {
            const arrDataNew = ['ig', strName];

            await contract.create(...arrDataNew);
            await contract.confirm(...arrDataNew);

            const arrRecords = await contract.resolve(strName);

            assert.deepEqual(arrRecords, {
                [strProvider]: global.callerAddress,
                ['ig']: global.callerAddress
            });
        });
    });
});
