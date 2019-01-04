const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');
const debug = require('debug')('peer:');

const {pseudoRandomBuffer} = require('./testUtil');

factory = require('./testFactory');

describe('TX Receipt tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create receipt', async () => {
        new factory.TxReceipt({
            contractAddress: pseudoRandomBuffer(20),
            coinsUsed: 10000,
            status: factory.Constants.TX_STATUS_OK
        });

        new factory.TxReceipt({
            contractAddress: pseudoRandomBuffer(20)
        });

        new factory.TxReceipt({});
    });

    it('should get contractAddress', async () => {
        const contractAddress = pseudoRandomBuffer(20);
        {
            const receipt = new factory.TxReceipt({
                contractAddress
            });
            assert.isOk(contractAddress.equals(receipt.getContractAddress()));
        }
        {
            const receipt = new factory.TxReceipt({
                contractAddress: undefined
            });
            assert.isOk(Array.isArray(receipt.getContractAddress()));
            assert.equal(receipt.getContractAddress().length, 0);
        }
    });

    it('should get CoinsUsed', async () => {
        {
            const coinsUsed = 123456;
            const receipt = new factory.TxReceipt({
                coinsUsed
            });
            assert.equal(coinsUsed, receipt.getCoinsUsed());
        }
        {
            const receipt = new factory.TxReceipt({
                coinsUsed: undefined
            });
            assert.isNotOk(receipt.getCoinsUsed());
        }
    });

    it('should get Status', async () => {
        {
            const status = factory.Constants.TX_STATUS_OK;
            const receipt = new factory.TxReceipt({
                status
            });
            assert.equal(status, receipt.getStatus());
        }
        {
            const receipt = new factory.TxReceipt({
                status: undefined
            });
            assert.equal(receipt.getStatus(), factory.Constants.TX_STATUS_FAILED);
        }
    });

    it('should encode/decode receipt', async () => {
        const receipt = new factory.TxReceipt({
            contractAddress: pseudoRandomBuffer(20),
            coinsUsed: 10000,
            status: factory.Constants.TX_STATUS_OK
        });

        const buffData = receipt.encode();
        assert.isOk(buffData);

        const restoredReceipt = new factory.TxReceipt(buffData);
        assert.deepEqual(receipt._data, restoredReceipt._data);
    });

    it('should be equal (with self)', async () => {
        const receipt = new factory.TxReceipt({
            contractAddress: pseudoRandomBuffer(20),
            coinsUsed: 10000,
            status: factory.Constants.TX_STATUS_OK
        });

        assert.isOk(receipt.equals(receipt));
    });

    it('should be unequal', async () => {
        const receipt = new factory.TxReceipt({
            contractAddress: pseudoRandomBuffer(20),
            coinsUsed: 10000,
            status: factory.Constants.TX_STATUS_OK
        });

        const receipt2 = new factory.TxReceipt({
            contractAddress: pseudoRandomBuffer(20),
            coinsUsed: 1000,
            status: factory.Constants.TX_STATUS_OK
        });

        assert.isNotOk(receipt.equals(receipt2));
    });
});
