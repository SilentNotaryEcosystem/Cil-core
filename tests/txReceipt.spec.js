const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');
const debug = require('debug')('peer:');

const {pseudoRandomBuffer, generateAddress} = require('./testUtil');

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
            contractAddress: generateAddress(),
            coinsUsed: 10000,
            status: factory.Constants.TX_STATUS_OK
        });

        new factory.TxReceipt({
            contractAddress: generateAddress()
        });

        new factory.TxReceipt({});
    });

    it('should get contractAddress', async () => {
        const contractAddress = generateAddress();
        {

            // good address
            const receipt = new factory.TxReceipt({
                contractAddress
            });
            assert.isOk(contractAddress.equals(Buffer.from(receipt.getContractAddress(), 'hex')));
        }
        {

            // empty address
            const receipt = new factory.TxReceipt({
                contractAddress: undefined
            });
            assert.isNotOk(receipt.getContractAddress());
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
            assert.isOk(receipt.isSuccessful());
        }
        {
            const receipt = new factory.TxReceipt({
                status: undefined
            });
            assert.isNotOk(receipt.isSuccessful());
        }
    });

    it('should return message', async () => {
        {
            const message = 'Some error message';
            const receipt = new factory.TxReceipt({
                message
            });
            assert.equal(receipt.getMessage(), message);
        }
    });

    it('should encode/decode receipt', async () => {
        const receipt = new factory.TxReceipt({
            contractAddress: generateAddress(),
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
            contractAddress: generateAddress(),
            coinsUsed: 10000,
            status: factory.Constants.TX_STATUS_OK
        });

        assert.isOk(receipt.equals(receipt));
    });

    it('should be unequal', async () => {
        const receipt = new factory.TxReceipt({
            contractAddress: generateAddress(),
            coinsUsed: 10000,
            status: factory.Constants.TX_STATUS_OK
        });

        const receipt2 = new factory.TxReceipt({
            contractAddress: generateAddress(),
            coinsUsed: 1000,
            status: factory.Constants.TX_STATUS_OK
        });

        assert.isNotOk(receipt.equals(receipt2));
    });

    it('should add internal tx', async () => {
        const receipt = new factory.TxReceipt({});
        const arrInternalTxnsHashes = [pseudoRandomBuffer().toString('hex'), pseudoRandomBuffer().toString('hex')];
        arrInternalTxnsHashes
            .map(
                txHash => new factory.UTXO({txHash}).addCoins(
                    0,
                    factory.Coins.createFromData({
                        amount: 100,
                        receiverAddr: generateAddress()
                    })
                ))
            .forEach(utxo => receipt.addInternalUtxo(utxo));

        const arrBuffTxns = receipt.getInternalTxns();
        assert.equal(arrBuffTxns.length, 2);
        assert.isOk(arrBuffTxns.every(buffTxns => arrInternalTxnsHashes.includes(buffTxns.toString('hex'))));
    });

    it('should getCoinsForTx', async () => {
        const receipt = new factory.TxReceipt({});
        const arrInternalTxnsHashes = [pseudoRandomBuffer().toString('hex'), pseudoRandomBuffer().toString('hex')];
        arrInternalTxnsHashes
            .map(
                txHash => new factory.UTXO({txHash}).addCoins(
                    0,
                    factory.Coins.createFromData({
                        amount: 100,
                        receiverAddr: generateAddress()
                    })
                ))
            .forEach(utxo => receipt.addInternalUtxo(utxo));

        assert.isOk(receipt.getCoinsForTx(arrInternalTxnsHashes[0]));
        assert.isOk(receipt.getCoinsForTx(arrInternalTxnsHashes[1]));
    });

    it('should convert to object', async () => {
        const objReceipt = {
            contractAddress: generateAddress(),
            coinsUsed: 1000,
            status: factory.Constants.TX_STATUS_OK,
            internalTxns: [
                pseudoRandomBuffer(),
                pseudoRandomBuffer()
            ],
            coins: [
                {amount: 100, receiverAddr: generateAddress()},
                {amount: 100, receiverAddr: generateAddress()}
            ]
        };
        const receipt2 = new factory.TxReceipt(objReceipt);
        assert.deepEqual({
                ...objReceipt,
                contractAddress: objReceipt.contractAddress.toString('hex'),
                internalTxns: objReceipt.internalTxns.map(buffHash => buffHash.toString('hex'))
            },
            receipt2.toObject()
        );
    });

    describe('Merge receipts', async () => {
        const nCoinUsed1 = 1000;
        const nCoinUsed2 = 2000;
        let arrInternalTxns;
        let receipt1;
        let receipt2;

        beforeEach(async () => {

            arrInternalTxns = [
                pseudoRandomBuffer(), pseudoRandomBuffer(), pseudoRandomBuffer(), pseudoRandomBuffer()];

            const objReceipt1 = {
                contractAddress: generateAddress(),
                coinsUsed: nCoinUsed1,
                status: factory.Constants.TX_STATUS_OK,
                internalTxns: [
                    arrInternalTxns[0],
                    arrInternalTxns[1]
                ],
                coins: [
                    {amount: 100, receiverAddr: generateAddress()},
                    {amount: 100, receiverAddr: generateAddress()}
                ]
            };

            const objReceipt2 = {
                contractAddress: generateAddress(),
                coinsUsed: nCoinUsed2,
                status: factory.Constants.TX_STATUS_FAILED,
                internalTxns: [
                    arrInternalTxns[2],
                    arrInternalTxns[3]
                ],
                coins: [
                    {amount: 200, receiverAddr: generateAddress()},
                    {amount: 200, receiverAddr: generateAddress()}
                ]
            };

            receipt1 = new factory.TxReceipt(objReceipt1);
            receipt2 = new factory.TxReceipt(objReceipt2);

            receipt1.setStatus(factory.Constants.TX_STATUS_OK);
            receipt2.setStatus(factory.Constants.TX_STATUS_OK);
        });

        it('should merge receipt', async () => {
            receipt1.merge(receipt2);

            assert.equal(receipt1.getCoinsUsed(), nCoinUsed2);
            assert.equal(receipt1.getInternalTxns().length, 4);

            for (let buffTxHash of arrInternalTxns) {
                assert.isOk(receipt1.getCoinsForTx(buffTxHash));
            }
        });

        it('should be TX_STATUS_OK after merge', async () => {
            receipt1.merge(receipt2);

            assert.isOk(receipt1.isSuccessful());
        });

        it('should be TX_STATUS_FAILED after merge (first failed)', async () => {
            receipt1.setStatus(factory.Constants.TX_STATUS_FAILED);
            receipt1.merge(receipt2);

            assert.isNotOk(receipt1.isSuccessful());
        });

        it('should be TX_STATUS_FAILED after merge (second failed)', async () => {
            receipt2.setStatus(factory.Constants.TX_STATUS_FAILED);
            receipt1.merge(receipt2);

            assert.isNotOk(receipt1.isSuccessful());
        });
    });

});
