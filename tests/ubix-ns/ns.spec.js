'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
const elliptic = require('elliptic');

const {Ns: NsContract} = require('./ns');
const factory = require('../testFactory');
const {generateAddress, pseudoRandomBuffer} = require('../testUtil');

chai.use(require('chai-as-promised'));
const {assert} = chai;
const ec = new elliptic.ec('secp256k1');

let contract;
let strPubliсKey, strPrivateKey;

const getVerificationCode = (strProvider, strName, strAddress) => {
    const strProviderLower = strProvider.trim().toLowerCase();
    const strNameLower = strName.trim().toLowerCase();
    const strAddressLower = strAddress.trim().toLowerCase().replace(/^ux/, '');

    const strToSign = `${strProviderLower}:${strNameLower}:${strAddressLower}`;

    return Buffer.from(JSON.stringify(ec.sign(strToSign, strPrivateKey, 'hex')), 'binary').toString('base64');
};

describe('Ubix NS', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
        const kp = ec.genKeyPair();
        strPubliсKey = kp.getPublic(true, 'hex');
        strPrivateKey = kp.getPrivate('hex');
    });

    after(async function () {
        // this.timeout(15000);
    });

    beforeEach(async () => {
        global.value = 0;
        global.callerAddress = generateAddress().toString('hex');
        global.contractTx = pseudoRandomBuffer().toString('hex');
        contract = new NsContract(strPubliсKey);
    });

    describe('check Ubix NS public key', async () => {
        beforeEach(async () => {
            global.value = 130000;
        });

        it('should throw (Contract should have valid public key) from constructor', async () => {
            assert.throws(() => new NsContract(), 'Contract should have valid public key');
        });

        it('should throw (Contract should have valid public key) from setter', async () => {
            assert.throws(() => contract.setPublicKey(null), 'Contract should have valid public key');
        });

        it('should pass', async () => {
            assert.isOk(contract);
        });

        it('should throw (Unauthorized call)', async () => {
            global.callerAddress = generateAddress().toString('hex');

            assert.throws(() => contract.setPublicKey(strPubliсKey), 'Unauthorized call');
        });
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
        let strVerificationCode;

        beforeEach(async () => {
            global.value = 130000;
            arrData = ['tg', 'mytestname', 'Ux121212121212'];
            strVerificationCode = getVerificationCode(...arrData);
        });

        it('should create', async () => {
            assert.equal(Object.keys(contract._ns).length, 0);

            await contract.create(...arrData, strVerificationCode);

            assert.equal(Object.keys(contract._ns).length, 1);

            assert.deepEqual(await contract.resolve('mytestname'), {[arrData[0]]: arrData[2]});
        });

        it('should throw (unsigned TX)', async () => {
            global.callerAddress = undefined;
            assert.isRejected(contract.create(...arrData, strVerificationCode), 'You should sign TX');
        });

        it('should throw (low create fee)', async () => {
            global.value = 130000 - 1;
            assert.isRejected(contract.create(...arrData, strVerificationCode), 'Update fee is 130000');
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.isRejected(
                contract.create(null, 'mytestname', 'Ux121212121212', strVerificationCode),
                'strProvider should be a string'
            );
        });

        it('should throw (strName should be a string)', async () => {
            assert.isRejected(
                contract.create('tg', null, 'Ux121212121212', strVerificationCode),
                'strName should be a string'
            );
        });

        it('should throw (strAddress should be a string)', async () => {
            assert.isRejected(
                contract.create('tg', 'mytestname', null, strVerificationCode),
                'strAddress should be a string'
            );
        });

        it('should throw (strVerificationCode should be a string)', async () => {
            assert.isRejected(
                contract.create('tg', 'mytestname', 'Ux121212121212', null),
                'strVerificationCode should be a string'
            );
        });

        it('should throw (strProvider is not in the providers list)', async () => {
            assert.isRejected(
                contract.create('whatsapp', 'mytestname', 'Ux121212121212', strVerificationCode),
                'strProvider is not in the providers list'
            );
        });

        it('should throw (create twice)', async () => {
            await contract.create(...arrData, strVerificationCode);

            assert.isRejected(contract.create(...arrData, strVerificationCode), 'Hash has already defined');
        });

        it('should throw (Not valid verification code)', async () => {
            const strVerificationCode = getVerificationCode('', '', '');
            assert.isRejected(contract.create(...arrData, strVerificationCode), 'Not valid verification code');
        });
    });

    describe('remove Ubix NS record', async () => {
        let arrData;
        const strName = 'mytestname';

        beforeEach(async () => {
            global.value = 130000;
            arrData = ['tg', strName, 'Ux121212121212'];
        });

        it('should remove', async () => {
            const strVerificationCode = getVerificationCode(...arrData);

            await contract.create(...arrData, strVerificationCode);

            assert.equal(Object.keys(contract._ns).length, 1);

            await contract.remove(...arrData.slice(0, 2));

            assert.equal(Object.keys(contract._ns).length, 0);
        });

        it('should throw (Hash is not found)', async () => {
            assert.isRejected(contract.remove(...arrData.slice(0, 2)), 'Hash is not found');
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
            const strVerificationCode = getVerificationCode(...arrData);
            await contract.create(...arrData, strVerificationCode);

            global.callerAddress = generateAddress().toString('hex');

            assert.isRejected(contract.remove('tg', 'mytestname'), 'You are not the owner');
        });
    });

    describe('resolve Ubix NS record', async () => {
        let arrData;
        const strProvider = 'tg';
        const strName = 'mytestname';
        const strAddress = 'Ux121212121212';
        let strVerificationCode;

        beforeEach(async () => {
            global.value = 130000;
            arrData = [strProvider, strName, strAddress];

            strVerificationCode = getVerificationCode(...arrData);

            await contract.create(...arrData, strVerificationCode);
        });

        it('should throw (Hash is not found)', async () => {
            assert.isRejected(contract.resolve('NONAME'), 'Hash is not found');
        });

        it('should throw (strName should be a string)', async () => {
            assert.isRejected(contract.resolve(null), 'strName should be a string');
        });

        it('should pass', async () => {
            const arrRecords = await contract.resolve(strName);

            assert.deepEqual(arrRecords, {
                [strProvider]: strAddress
            });
        });

        it('should resolve 2 records for the different providers', async () => {
            const arrDataNew = ['ig', strName, strAddress];

            const strIgVerificationCode = getVerificationCode(...arrDataNew);

            await contract.create(...arrDataNew, strIgVerificationCode);

            const arrRecords = await contract.resolve(strName);

            assert.deepEqual(arrRecords, {
                [strProvider]: strAddress,
                ['ig']: strAddress
            });
        });
    });

    describe('verify Ubix NS record', async () => {
        beforeEach(async () => {
            global.value = 130000;
        });

        it('should throw (strProvider is not in the providers list)', async () => {
            assert.isRejected(
                contract.getVeficationCode('whatsapp', 'NONAME', 'ADDRESS'),
                'strProvider is not in the providers list'
            );
        });

        it('should throw (strProvider should be a string)', async () => {
            assert.isRejected(contract.getVeficationCode(null, 'NONAME', 'ADDRESS'), 'strProvider should be a string');
        });

        it('should throw (strName should be a string)', async () => {
            assert.isRejected(contract.getVeficationCode('tg', null, 'ADDRESS'), 'strName should be a string');
        });
    });
});
