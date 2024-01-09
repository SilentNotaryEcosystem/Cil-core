const v8 = require('v8');
const {describe, it} = require('mocha');
const {assert} = require('chai');

factory = require('./testFactory');

const encodedContractSample =
    '0a077b2261223a317d1224227b5c226164645c223a205c222861297b746869732e76616c75652b3d613b7d5c227d2218012100000000000000002802;';

describe('Contract tests', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function () {
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

        new factory.Contract(Buffer.from(encodedContractSample, 'hex'));
    });

    describe('Set version upon constructing', function () {
        it('should be V_JSON', async () => {
            const contract = new factory.Contract(
                {
                    contractData: {a: 1}
                },
                'asdasd',
                factory.Constants.CONTRACT_V_JSON
            );

            assert.equal(contract.getVersion(), factory.Constants.CONTRACT_V_JSON);
        });

        it('should be V_V8', async () => {
            const contract = new factory.Contract(
                {
                    contractData: {a: 1}
                },
                'asdasd',
                factory.Constants.CONTRACT_V_V8
            );

            assert.equal(contract.getVersion(), factory.Constants.CONTRACT_V_V8);
        });
    });

    describe('Get data', async () => {
        it('should get empty', async () => {
            const contract = new factory.Contract({});
            assert.deepEqual(contract.getData(), {});
        });

        it('should get (from Object)', async () => {
            const data = {a: 1};
            const contract = new factory.Contract({contractData: data});
            assert.deepEqual(contract.getData(), data);
        });

        it('should get (from Buffer)', async () => {
            const data = {a: 1};
            const contract = new factory.Contract(Buffer.from(encodedContractSample, 'hex'));
            assert.deepEqual(contract.getData(), data);
        });
    });

    describe('getDataBuffer', async () => {
        it('should get empty', async () => {
            const contract = new factory.Contract({});
            assert.deepEqual(contract.getDataBuffer(), Buffer.from('{}'));
        });

        it('should get (from Object)', async () => {
            const data = {a: 1};
            const contract = new factory.Contract({contractData: data});
            assert.deepEqual(contract.getDataBuffer(), Buffer.from(JSON.stringify(data)));
        });

        it('should get (from Buffer)', async () => {
            const data = {a: 1};
            const contract = new factory.Contract(Buffer.from(encodedContractSample, 'hex'));
            assert.deepEqual(contract.getDataBuffer(), Buffer.from(JSON.stringify(data)));
        });
    });

    describe('Get code', async () => {
        it('should get empty', async () => {
            const contract = new factory.Contract({});
            assert.isNotOk(contract.getCode());
        });

        it('should get (from Object)', async () => {
            const code = '{"add": "(a){this.value+=a;}"}';
            const contract = new factory.Contract({
                contractCode: code
            });
            assert.deepEqual(contract.getCode(), JSON.parse(code));
        });

        it('should get (from Buffer)', async () => {
            const code = '{"add": "(a){this.value+=a;}"}';
            const contract = new factory.Contract(Buffer.from(encodedContractSample, 'hex'));
            assert.strictEqual(contract.getCode(), code);
        });
    });

    describe('Encode contract', async () => {
        it('should encode empty contract', async () => {
            const contract = new factory.Contract({});
            assert.isOk(contract.encode());
        });

        it('should encode contract only with code', async () => {
            const contract = new factory.Contract({
                contractCode: '{"add": "(a){this.value+=a;}"}'
            });
            assert.isOk(contract.encode());
        });

        it('should encode contract only with data', async () => {
            const contract = new factory.Contract({
                contractData: {a: 1}
            });
            assert.isOk(contract.encode());
        });

        it('should encode contract with both', async () => {
            const contract = new factory.Contract({
                contractData: {a: 1},
                contractCode: '{"add": "(a){this.value+=a;}"}',
                conciliumId: 1
            });
            assert.isOk(contract.encode());
            console.log(contract.encode().toString('hex'));
        });
    });

    describe('Version', async () => {
        it('should be v2 for created from Object', async () => {
            const contract = new factory.Contract({
                contractData: {a: 1}
            });

            assert.equal(contract.getVersion(), 2);
        });

        it('should be still v2 after encode/recreate', async () => {
            const contract = new factory.Contract({
                contractData: {a: 1}
            });
            const buffContract = contract.encode();

            const decodedContract = new factory.Contract(buffContract);

            assert.equal(decodedContract.getVersion(), 2);
        });

        it('should be still v2 after clone', async () => {
            const contract = new factory.Contract({
                contractData: {a: 1}
            });
            const clonedContract = contract.clone();

            assert.equal(clonedContract.getVersion(), 2);
        });

        it('should be still v0 after encode/recreate', async () => {
            const contract = new factory.Contract({
                contractData: {a: 1}
            });
            contract.switchSerializerToOld();
            const buffContract = contract.encode();

            const decodedContract = new factory.Contract(buffContract);

            assert.equal(decodedContract.getVersion(), 0);
        });

        it('should be still v0 after clone', async () => {
            const contract = new factory.Contract({
                contractData: {a: 1}
            });
            contract.switchSerializerToOld();

            const clonedContract = contract.clone();

            assert.equal(clonedContract.getVersion(), 0);
        });
    });

    describe('Update data', async () => {});

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
        const data = {a: 1, m: {key: 'value'}, str: 'bla-bla'};
        const contract = new factory.Contract({
            contractData: data,
            conciliumId: 10,
            balance: 100
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

    describe('Dirty workaround', function () {
        let data;
        let contract;

        beforeEach(async () => {
            data = {
                key: 'value',
                arrValue: [1, 2, 3, 4],
                objValue: {
                    nestedKey: 'value'
                }
            };

            contract = new factory.Contract({contractData: data});
        });

        it('should leave unchanged (no data was changed)', async () => {
            contract.switchSerializerToOld();

            const oldVerContract = new factory.Contract(contract.encode());

            oldVerContract.dirtyWorkaround();
            oldVerContract.getDataBuffer();

            assert.deepEqual(oldVerContract.getData(), data);
            assert.equal(oldVerContract.getDataBuffer().length, contract.getDataBuffer().length);
        });

        it('should do workaround (data changed)', async () => {
            contract.switchSerializerToOld();

            const oldVerContract = new factory.Contract(contract.encode());
            oldVerContract.updateData(data);

            oldVerContract.dirtyWorkaround();

            assert.deepEqual(oldVerContract.getData(), data);
            assert.notEqual(oldVerContract.getDataBuffer().length, contract.getDataBuffer().length);
        });

        it('should do workaround for new contract without data', async () => {
            contract = new factory.Contract({contractData: {}});
            contract.switchSerializerToOld();

            contract.dirtyWorkaround();
            assert.isOk(contract._bPatched);
        });

        it('should do workaround for new contract with data', async () => {
            contract.switchSerializerToOld();

            contract.dirtyWorkaround();
            assert.isOk(contract._bPatched);
        });
    });
});
