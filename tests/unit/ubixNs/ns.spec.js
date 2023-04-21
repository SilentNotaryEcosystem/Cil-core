'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const {Ns: NsContract} = require('./ns');

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

        it('should remove a provider', async () => {
            contract.removeProvider('tg');
            const arrContractProviders = [...contract._providers].sort((a, b) => (a > b ? 1 : a === b ? 0 : -1));
            const arrProviders = ['email', 'ig'].sort((a, b) => (a > b ? 1 : a === b ? 0 : -1));

            assert.deepEqual(arrContractProviders, arrProviders);
        });
    });

    describe('create Ubix NS record', async () => {
        let arrData;
        let objData;

        beforeEach(async () => {
            global.value = 1000;
            arrData = ['tg', 'mytestname', '0x121212121212'];
            objData = {
                provider: arrData[0],
                address: arrData[2],
                isVerified: false
            };
        });

        it('should create', async () => {
            assert.equal(Object.keys(contract._ns).length, 0);

            await contract.create(...arrData);

            assert.equal(Object.keys(contract._ns).length, 1);
            assert.deepEqual(await contract.resolve('mytestname', false), [objData]);
        });

        it('should throw (unsigned TX)', async () => {
            global.callerAddress = undefined;
            assert.isRejected(contract.create(...arrData), 'You should sign TX');
        });

        it('should throw (low create fee)', async () => {
            global.value = 1e3 - 1;
            assert.isRejected(contract.create(...arrData), 'Update fee is 1000');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.isRejected(contract.create(null, 'mytestname', '0x121212121212'), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.isRejected(contract.create('tg', null, '0x121212121212'), 'strName should be a string');
        });

        it('should throw (strAddress should be a string)', async () => {
            assert.isRejected(contract.create('tg', 'mytestname', null), 'strAddress should be a string');
        });

        it('should throw (strProvider is not in the providers list)', async () => {
            assert.isRejected(
                contract.create('whatsapp', 'mytestname', '0x121212121212'),
                'strProvider is not in the providers list'
            );
        });

        it('should throw (create twice)', async () => {
            await contract.create(...arrData);
            assert.isRejected(contract.create(...arrData), 'Hash has already defined');
        });
    });

    describe('remove Ubix NS record', async () => {
        let arrData;
        const strName = 'mytestname';

        beforeEach(async () => {
            global.value = 1000;
            arrData = ['tg', strName, '0x121212121212'];
        });

        it('should remove', async () => {
            const hash = contract._sha256(strName);

            await contract.create(...arrData);

            assert.equal(Object.keys(contract._ns).length, 1);

            assert.equal(Object.keys(contract._ns[hash]).length, 1);
            await contract.remove(...arrData);

            assert.equal(Object.keys(contract._ns[hash]).length, 0);
        });

        it('should throw (Hash is not found)', async () => {
            assert.isRejected(contract.remove(...arrData), 'Hash is not found');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.isRejected(contract.remove(null, 'mytestname', '0x121212121212'), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.isRejected(contract.remove('tg', null, '0x121212121212'), 'strName should be a string');
        });

        it('should throw (strAddress should be a string)', async () => {
            assert.isRejected(contract.remove('tg', 'mytestname', null), 'strAddress should be a string');
        });

        it('should throw (strProvider is not in the providers list)', async () => {
            assert.isRejected(
                contract.remove('whatsapp', 'mytestname', '0x121212121212'),
                'strProvider is not in the providers list'
            );
        });
    });

    describe('resolve Ubix NS record', async () => {
        let arrData;
        const strProvider = 'tg';
        const strName = 'mytestname';
        const strAddress = '0x121212121212';

        beforeEach(async () => {
            global.value = 1000;
            arrData = [strProvider, strName, strAddress];

            await contract.create(...arrData);
        });

        it('should throw (Hash is not found)', async () => {
            assert.isRejected(contract.resolve('NONAME'), 'Hash is not found');
        });

        it('should throw (Hash is not found) (bVerifiedOnly = true)', async () => {
            assert.isRejected(contract.resolve(strName), 'Hash is not found');
        });

        it('should throw (strName should be a string)', async () => {
            assert.isRejected(contract.resolve(null), 'strName should be a string');
        });

        it('should pass', async () => {
            const arrRecords = await contract.resolve(strName, false);

            assert.equal(arrRecords[0].provider, strProvider);
            assert.equal(arrRecords[0].address, strAddress);
            assert.isFalse(arrRecords[0].isVerified);
        });
    });

    describe('verify Ubix NS record', async () => {
        let arrData;
        const strProvider = 'tg';
        const strName = 'mytestname';
        const strAddress = '0x121212121212';

        beforeEach(async () => {
            global.value = 1000;
            arrData = [strProvider, strName, strAddress];

            await contract.create(...arrData);
        });

        it('should throw (Hash is not found)', async () => {
            assert.isRejected(contract.getVeficationCode('tg', 'NONAME', 'ADDRESS'), 'Hash is not found');
        });

        it('should throw (strProvider is not in the providers list)', async () => {
            assert.isRejected(
                contract.getVeficationCode('whatsapp', 'NONAME', 'ADDRESS'),
                'strProvider is not in the providers list'
            );
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.isRejected(contract.remove(null, 'NAME', 'ADDRESS'), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.isRejected(contract.remove('NO', null, 'ADDRESS'), 'strName should be a string');
        });

        it('should throw (strAddress should be a string)', async () => {
            assert.isRejected(contract.remove('NO', 'NAME', null), 'strAddress should be a string');
        });

        it('should verify', async () => {
            assert.isRejected(contract.resolve(strName), 'Hash is not found');

            // TODO: Change after sign implementation
            const strCode = 'test code';
            // await contract.getVeficationCode(strProvider, strName, strAddress);

            await contract.verify(strProvider, strName, strAddress, strCode);

            const arrRecords = await contract.resolve(strName, false);

            assert.equal(arrRecords[0].provider, strProvider);
            assert.equal(arrRecords[0].address, strAddress);
        });
    });
});
