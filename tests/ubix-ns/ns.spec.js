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
            arrData = ['tg', 'mytestname', generateAddress().toString('hex')];
        });

        it('should create', async () => {
            assert.equal(Object.keys(contract._ns).length, 0);

            await contract.create(...arrData);

            assert.equal(Object.keys(contract._ns).length, 1);
            assert.deepEqual(await contract.resolve('mytestname'), {
                [arrData[0]]: arrData[2]
            });
        });

        it('should try to confirm not by the contract owner', async () => {
            global.callerAddress = generateAddress().toString('hex');
            assert.isRejected(contract.create(...arrData), 'Unauthorized call');
        });

        it('should throw (unsigned TX)', async () => {
            global.callerAddress = undefined;
            assert.isRejected(contract.create(...arrData), 'You should sign TX');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.isRejected(contract.create(null, 'mytestname', arrData[2]), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.isRejected(contract.create('tg', null, arrData[2]), 'strName should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.isRejected(contract.create('tg', 'mytestname', null), 'strWalletAddress should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.isRejected(contract.create('tg', 'mytestname', '1111'), 'Bad address');
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

        beforeEach(async () => {
            arrData = ['tg', 'mytestname', generateAddress().toString('hex')];
        });

        it('should remove', async () => {
            await contract.create(...arrData);

            assert.equal(Object.keys(contract._ns).length, 1);

            global.callerAddress = arrData[2];
            await contract.remove(...arrData.slice(0, 2));

            assert.equal(Object.keys(contract._ns).length, 0);
        });

        it('should throw (account is not found)', async () => {
            assert.isRejected(contract.remove(...arrData), 'Account is not found');
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

        beforeEach(async () => {
            arrData = ['tg', 'mytestname', generateAddress().toString('hex')];

            await contract.create(...arrData);
        });

        it('should throw (account is not found)', async () => {
            assert.isRejected(contract.resolve('NONAME'), 'Account is not found');
        });

        it('should throw (strName should be a string)', async () => {
            assert.isRejected(contract.resolve(null), 'strName should be a string');
        });

        it('should pass', async () => {
            const arrRecords = await contract.resolve(arrData[1]);

            assert.deepEqual(arrRecords, {
                [arrData[0]]: arrData[2]
            });
        });

        it('should resolve 2 records for the different providers', async () => {
            const arrDataNew = ['ig', ...arrData.slice(1, 3)];

            await contract.create(...arrDataNew);

            const arrRecords = await contract.resolve(arrData[1]);

            assert.deepEqual(arrRecords, {
                [arrData[0]]: arrData[2],
                ig: arrData[2]
            });
        });
    });
});
