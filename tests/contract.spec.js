const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');
const debug = require('debug')('peer:');

const {pseudoRandomBuffer} = require('./testUtil');

factory = require('./testFactory');

describe('Contract tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create contract', async () => {
        new factory.Contract({
            contractData: {a: 1},
            contractCode: 'let a=1;',
            groupId: 1
        });

        new factory.Contract({
            contractData: {a: 1}
        });

        new factory.Contract({});
    });

    it('should get data', async () => {
        const data = {a: 1};
        const contract = new factory.Contract({
            contractData: data,
            contractCode: 'let a=1;',
            groupId: 1
        });
        assert.deepEqual(data, contract.getData());
    });

    it('should get code', async () => {
        const code = 'let a=1;';
        const contract = new factory.Contract({
            contractCode: code,
            groupId: 1
        });
        assert.deepEqual(code, contract.getCode());
    });

    it('should update data', async () => {
        const data = {a: 1};
        const contract = new factory.Contract({
            contractData: data
        });
        const newData = {a: 2};
        contract.updateData(newData);

        assert.deepEqual(newData, contract.getData());
    });

    it('should encode/decode contract', async () => {
        const data = {a: 1, m: new Map([[1, 1]]), s: new Set([1, 2, 3])};
        const contract = new factory.Contract({
            contractData: data,
            groupId: 10
        });

        const buffer = contract.encode();
        const decodedContract = new factory.Contract(buffer);

        assert.deepEqual(data, decodedContract.getData());
    });

});
