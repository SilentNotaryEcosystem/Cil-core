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
            conciliumId: 1
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
            conciliumId: 1
        });
        assert.deepEqual(data, contract.getData());
    });

    it('should get code', async () => {
        const code = '{"add": "(a){this.value+=a;}"}';
        const contract = new factory.Contract({
            contractCode: code,
            conciliumId: 1
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
            conciliumId: 10,
            balance: 100
        });

        const buffer = contract.encode();
        const decodedContract = new factory.Contract(buffer);

        assert.deepEqual(data, decodedContract.getData());
    });

    it('should clone Contract', async () => {
        const contract = new factory.Contract({
            contractData: {a: 10},
            conciliumId: 10
        });

        const clone = contract.clone();

        assert.isOk(contract.encode().equals(clone.encode()));
    });

    describe('Balance', () => {
        it('should get balance', async () => {
            {
                // not initialized
                const contract = new factory.Contract({});
                assert.equal(contract.getBalance(), 0);
            }
            {
                const contract = new factory.Contract({balance: 100, bla: 17});
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

    describe('Proxy contracts', async () => {
        it('should proxy it', async () => {
            const contract = new factory.Contract({});
            const newContract = new factory.Contract({});
            newContract.proxyContract(contract);
        });

        it('should get proxied balance', async () => {
            const nInitialBalance = 100;
            const contract = new factory.Contract({});
            contract.deposit(nInitialBalance);

            const newContract = new factory.Contract({});
            newContract.proxyContract(contract);

            assert.equal(contract.getBalance(), nInitialBalance);
            assert.equal(newContract.getBalance(), nInitialBalance);
        });

        it('should deposit to proxied contract', async () => {
            const nInitialBalance = 100;
            const nAmount = 100;

            const contract = new factory.Contract({});
            contract.deposit(nInitialBalance);
            const newContract = new factory.Contract({});
            newContract.proxyContract(contract);

            newContract.deposit(nAmount);

            assert.equal(contract.getBalance(), nInitialBalance + nAmount);
            assert.equal(newContract.getBalance(), nInitialBalance + nAmount);
        });

        it('should withdraw from proxied contract', async () => {
            const nInitialBalance = 100;
            const nAmount = 100;

            const contract = new factory.Contract({});
            contract.deposit(nInitialBalance);
            const newContract = new factory.Contract({});
            newContract.proxyContract(contract);

            newContract.withdraw(nAmount);

            assert.equal(contract.getBalance(), nInitialBalance - nAmount);
            assert.equal(newContract.getBalance(), nInitialBalance - nAmount);
        });

        it('should FAIL to withdraw from proxied contract (not enough moneys)', async () => {
            const nInitialBalance = 100;
            const nAmount = 101;

            const contract = new factory.Contract({});
            contract.deposit(nInitialBalance);
            const newContract = new factory.Contract({});
            newContract.proxyContract(contract);

            assert.throws(() => newContract.withdraw(nAmount), 'Insufficient funds!');
        });

        it('should WITHDRAW from DEEP proxied contract', async () => {
            const nInitialBalance = 100;
            const nAmount = 100;

            const contract = new factory.Contract({});
            contract.deposit(nInitialBalance);
            const newContract = new factory.Contract({});
            newContract.proxyContract(contract);
            const depthTwoContract = new factory.Contract({});
            depthTwoContract.proxyContract(newContract);

            depthTwoContract.withdraw(nAmount);

            assert.equal(contract.getBalance(), nInitialBalance - nAmount);
            assert.equal(newContract.getBalance(), nInitialBalance - nAmount);
            assert.equal(depthTwoContract.getBalance(), nInitialBalance - nAmount);
        });

        it('should DEPOSIT TO DEEP proxied contract', async () => {
            const nInitialBalance = 100;
            const nAmount = 100;

            const contract = new factory.Contract({});
            contract.deposit(nInitialBalance);
            const newContract = new factory.Contract({});
            newContract.proxyContract(contract);
            const depthTwoContract = new factory.Contract({});
            depthTwoContract.proxyContract(newContract);

            depthTwoContract.deposit(nAmount);

            assert.equal(contract.getBalance(), nInitialBalance + nAmount);
            assert.equal(newContract.getBalance(), nInitialBalance + nAmount);
            assert.equal(depthTwoContract.getBalance(), nInitialBalance + nAmount);
        });

    });

    describe('Data size', () => {
        it('should be zero', async () => {
            {
                const contract = new factory.Contract({
                    conciliumId: 10
                });

                assert.equal(contract.getDataSize(), 0);
            }
            {
                const contract = new factory.Contract({
                    contractData: {},
                    conciliumId: 10
                });

                assert.equal(contract.getDataSize(), 0);
            }
            {
                const contract = new factory.Contract({
                    conciliumId: 10
                });

                const decodedContract = new factory.Contract(contract.encode());
                assert.equal(decodedContract.getDataSize(), 0);
            }
            {
                const contract = new factory.Contract({
                    contractData: {},
                    conciliumId: 10
                });

                const decodedContract = new factory.Contract(contract.encode());
                assert.equal(decodedContract.getDataSize(), 0);
            }
        });

        it('should be non zero', async () => {
            {
                const contract = new factory.Contract({
                    contractData: {a: 1},
                    conciliumId: 10
                });

                assert.notEqual(contract.getDataSize(), 0);
            }
            {
                const contract = new factory.Contract({
                    contractData: {a: 1},
                    conciliumId: 10
                });

                const decodedContract = new factory.Contract(contract.encode());
                assert.notEqual(decodedContract.getDataSize(), 0);
            }
        });

        it('should update data', async () => {
            {
                const contract = new factory.Contract({
                    contractData: {a: 1},
                    conciliumId: 10
                });

                const prevDataSize = contract.getDataSize();
                assert.notEqual(prevDataSize, 0);

                contract.updateData({a: 10, b: 100});
                assert.isAbove(contract.getDataSize(), prevDataSize);
            }

            {
                const contract = new factory.Contract({
                    contractData: {},
                    conciliumId: 10
                });

                const prevDataSize = contract.getDataSize();
                assert.equal(prevDataSize, 0);

                contract.updateData({a: 10});
                assert.isAbove(contract.getDataSize(), prevDataSize);
            }

            {
                const contract = new factory.Contract({
                    contractData: {},
                    conciliumId: 10
                });

                const decodedContract = new factory.Contract(contract.encode());
                decodedContract.updateData({a: 10});
                assert.isAbove(decodedContract.getDataSize(), contract.getDataSize());
            }

            {
                const contract = new factory.Contract({
                    contractData: {a: 1},
                    conciliumId: 10
                });

                const decodedContract = new factory.Contract(contract.encode());
                decodedContract.updateData({a: 10, b: 100});
                assert.isAbove(decodedContract.getDataSize(), contract.getDataSize());
            }
        });
    });

});
