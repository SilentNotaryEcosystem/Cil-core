const {describe, it} = require('mocha');
const {assert} = require('chai');

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
            contractCode: '{"add": "(a){this.value+=a;}"}',
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
            contractCode: '{"add": "(a){this.value+=a;}"}',
            groupId: 1
        });
        assert.deepEqual(data, contract.getData());
    });

    it('should get code', async () => {
        const code = '{"add": "(a){this.value+=a;}"}';
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

    describe('Balance', () => {
        it('should get balance', async () => {
            {
                // not initialized
                const contract = new factory.Contract({});
                assert.equal(contract.getBalance(), 0);
            }
            {
                const contract = new factory.Contract({balance: 100});
                assert.equal(contract.getBalance(), 100);
            }
            {
                const contract = new factory.Contract({balance: 100});
                const recoveredContract = new factory.Contract(contract.encode());
                assert.equal(recoveredContract.getBalance(), 100);
            }
        });

        it('should add moneys to balance', async () => {
            {
                // not initialized
                const contract = new factory.Contract({});
                contract.deposit(112);
                assert.equal(contract.getBalance(), 112);
            }
            {
                const contract = new factory.Contract({balance: 100});
                contract.deposit(112);
                assert.equal(contract.getBalance(), 212);
            }
        });

        it('should deduce moneys from balance', async () => {
            {
                // not initialized
                const contract = new factory.Contract({});
                assert.throws(() => contract.withdraw(112));
            }
            {
                const contract = new factory.Contract({balance: 100});

                // too much
                assert.throws(() => contract.withdraw(112));
            }
            {
                const contract = new factory.Contract({balance: 100});
                contract.withdraw(23);
                assert.equal(contract.getBalance(), 77);
            }
        });
    });

});
