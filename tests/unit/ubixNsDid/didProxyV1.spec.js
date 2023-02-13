'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
const sinon = require('sinon').createSandbox();
chai.use(require('chai-as-promised'));
const {assert} = chai;

const {DidProxyV1: DidProxyContract} = require('./didProxyV1');

const factory = require('../../testFactory');

const {generateAddress} = require('../../testUtil');

let contract;

describe('Ubix DID Proxy', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function () {
        // this.timeout(15000);
    });

    beforeEach(async () => {
        global.value = 1000;
        global.callerAddress = generateAddress().toString('hex');
        global.call = sinon.fake();
        global.createHash = str => factory.Crypto.createHash(str);
        contract = new DidProxyContract();
    });

    describe('should add a DID contract to proxy', async () => {
        it('should create', async () => {
            const objData = {
                strIssuerName: 'Me',
                strDidContractAddress: '234556456756784563453464567456456'
            };

            assert.equal(Object.keys(contract._data).length, 0);
            contract.add(objData);
            assert.equal(Object.keys(contract._data).length, 1);
            assert.equal(contract._strServiceAddress, objData.strDidContractAddress);
        });
    });

    describe('create DID document', async () => {
        let objData;

        beforeEach(async () => {
            global.value = 130000;

            objData = {
                objDidDocument: {
                    tg: 'my-tele-nick',
                    email: 'my-email@test.com'
                },
                strIssuerName: 'Me'
            };
        });

        it('should throw (unsigned TX)', async () => {
            global.callerAddress = undefined;
            assert.isRejected(contract.create(objData), 'You should sign TX');
        });

        it('should throw (low create fee)', async () => {
            global.value = 1000 - 1;
            assert.isRejected(contract.create(objData), 'Update fee is 1000');
        });
    });

    describe('remove DID document', async () => {
        let strDidAddress;

        beforeEach(async () => {
            global.value = 130000;
            strDidAddress = '23543465464575675675675';
        });

        it('should throw (unsigned TX)', async () => {
            global.callerAddress = undefined;
            assert.isRejected(contract.remove(strDidAddress), 'You should sign TX');
        });

        it('should throw (low create fee)', async () => {
            global.value = 1000 - 1;
            assert.isRejected(contract.remove(strDidAddress), 'Update fee is 1000');
        });
    });

    describe('replace Ubix NS record', async () => {
        let strDidAddress, objNewData;

        beforeEach(async () => {
            global.value = 130000;

            strDidAddress = '23543465464575675675675';

            objNewData = {
                objDidDocument: {
                    tg: 'new-tele-nick',
                    email: 'new-email@test.com'
                },
                strIssuerName: 'Not me'
            };
        });

        it('should throw (unsigned TX)', async () => {
            global.callerAddress = undefined;
            assert.isRejected(contract.replace(strDidAddress, objNewData), 'You should sign TX');
        });

        it('should throw (low create fee)', async () => {
            global.value = 1000 - 1;
            assert.isRejected(contract.replace(strDidAddress, objNewData), 'Update fee is 1000');
        });
    });
});
