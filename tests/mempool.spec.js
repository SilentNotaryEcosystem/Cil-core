'use strict';

const fs = require('fs');
const {describe, it} = require('mocha');
const {assert} = require('chai');
const {createDummyTx, pseudoRandomBuffer} = require('./testUtil');
const sinon = require('sinon').createSandbox();

const factory = require('./testFactory');

// let keyPair;
let stubWrite;
// let stubRead;

describe('Mempool tests', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
        // keyPair = factory.Crypto.createKeyPair();
    });

    after(async function () {
        this.timeout(15000);
    });

    beforeEach(async () => {
        stubWrite = sinon.stub(fs, 'writeFileSync');
        // stubRead = sinon.stub(fs, 'readFileSync').returns('{}');
    });

    afterEach(async () => {
        sinon.restore();
    });

    it('should create mempool', async () => {
        const wrapper = () => new factory.Mempool();
        assert.doesNotThrow(wrapper);
    });

    it('should add tx to mempool', async () => {
        const mempool = new factory.Mempool();
        const tx = new factory.Transaction(createDummyTx());

        mempool.addTx(tx);
        assert.isOk(mempool.hasTx(tx.hash()));
    });

    it('should FAIL add tx to mempool (already exists)', async () => {
        // addTx
        {
            const mempool = new factory.Mempool();
            const tx = new factory.Transaction(createDummyTx());

            assert.doesNotThrow(() => mempool.addTx(tx));
            assert.throws(() => mempool.addTx(tx));
        }
    });

    it('should add 2 different tx', async () => {
        {
            const mempool = new factory.Mempool();
            const tx1 = new factory.Transaction(createDummyTx());
            const tx2 = new factory.Transaction(createDummyTx());

            mempool.addTx(tx1);
            mempool.addTx(tx2);

            // hash is String
            assert.isOk(mempool.hasTx(tx1.hash()));

            // hash is Buffer
            assert.isOk(mempool.hasTx(Buffer.from(tx2.hash(), 'hex')));
        }

        {
            const mempool = new factory.Mempool();
            const tx1 = new factory.Transaction(createDummyTx());
            const tx2 = new factory.Transaction(createDummyTx());

            mempool.addLocalTx(tx1);
            mempool.addLocalTx(tx2);

            // hash is String
            assert.isOk(mempool.hasTx(tx1.hash()));

            // hash is Buffer
            assert.isOk(mempool.hasTx(Buffer.from(tx2.hash(), 'hex')));
        }
    });

    it('should remove txns from mempool with new block', async () => {
        const mempool = new factory.Mempool();
        const tx1 = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());

        mempool.addTx(tx1);
        mempool.addLocalTx(tx2);

        mempool.removeForBlock([tx1.getHash(), tx2.getHash()]);

        assert.isNotOk(mempool.hasTx(tx1.hash()));
        assert.isNotOk(mempool.hasTx(tx2.hash()));
    });

    it('should get tx by hash', async () => {
        {
            const mempool = new factory.Mempool();
            const tx1 = new factory.Transaction(createDummyTx());

            mempool.addTx(tx1);

            const gotTx = mempool.getTx(tx1.hash());
            assert.isOk(gotTx.equals(tx1));
        }
        {
            const mempool = new factory.Mempool();
            const tx1 = new factory.Transaction(createDummyTx());

            mempool.addLocalTx(tx1);

            const gotTx = mempool.getTx(tx1.hash());
            assert.isOk(gotTx.equals(tx1));
        }
    });

    it('should getFinalTxns with specific conciliumId', async () => {
        const mempool = new factory.Mempool({testStorage: true});
        const tx1 = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());
        const tx3 = new factory.Transaction();
        tx3.rawData.payload.conciliumId = 2;
        const tx4 = new factory.Transaction(createDummyTx());

        mempool.addTx(tx1);
        mempool.addTx(tx2);
        mempool.addTx(tx3);
        mempool.addLocalTx(tx4);

        const arrTxns = mempool.getFinalTxns(0);
        assert.isOk(Array.isArray(arrTxns));
        assert.equal(arrTxns.length, 3);
    });

    it('should remove oldest txns with age > TX_LIFETIME(5s.)', async function () {
        const clock = sinon.useFakeTimers();

        const mempool = new factory.Mempool();
        const tx1 = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());
        const tx3 = new factory.Transaction(createDummyTx());

        mempool.addTx(tx1);
        mempool.addTx(tx2);

        clock.tick(factory.Constants.MEMPOOL_TX_LIFETIME + 1);
        mempool.addTx(tx3);

        mempool.purgeOutdated();

        assert.isNotOk(mempool.hasTx(tx1.hash()));
        assert.isNotOk(mempool.hasTx(tx2.hash()));
        assert.isOk(mempool.hasTx(tx3.hash()));
    });

    it('should remove outdated bad TXns', async function () {
        const clock = sinon.useFakeTimers();

        const mempool = new factory.Mempool();
        const hashTx1 = pseudoRandomBuffer().toString('hex');
        const hashTx2 = pseudoRandomBuffer().toString('hex');

        mempool.storeBadTxHash(hashTx1);
        mempool.storeBadTxHash(hashTx2);

        clock.tick(factory.Constants.MEMPOOL_BAD_TX_CACHE + 1);

        mempool.purgeOutdated();

        assert.isNotOk(mempool.isBadTx(hashTx1));
        assert.isNotOk(mempool.isBadTx(hashTx1));
    });

    it('should not remove  txns if tx age <= 5s. ', async () => {
        const mempool = new factory.Mempool();
        const tx1 = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());
        mempool.addTx(tx1);
        mempool.addTx(tx2);

        mempool.purgeOutdated();

        assert.isOk(mempool.hasTx(tx1.hash()));
        assert.isOk(mempool.hasTx(tx2.hash()));
    });

    it('should remove oldest txns if tx qty > MEMPOOL_TX_QTY(5)', async () => {
        factory.Constants.MEMPOOL_TX_QTY = 5;

        const mempool = new factory.Mempool();
        const tx1 = new factory.Transaction(createDummyTx());
        const tx2 = new factory.Transaction(createDummyTx());
        const tx3 = new factory.Transaction(createDummyTx());
        const tx4 = new factory.Transaction(createDummyTx());
        const tx5 = new factory.Transaction(createDummyTx());
        const tx6 = new factory.Transaction(createDummyTx());

        mempool.addTx(tx1);
        mempool.addTx(tx2);
        mempool.addTx(tx3);
        mempool.addTx(tx4);
        mempool.addTx(tx5);
        mempool.addTx(tx6);

        assert.isNotOk(mempool.hasTx(tx1.hash()));
        assert.isNotOk(mempool.hasTx(tx2.hash()));
        assert.isOk(mempool.hasTx(tx3.hash()));
        assert.isOk(mempool.hasTx(tx4.hash()));
        assert.isOk(mempool.hasTx(tx5.hash()));
        assert.isOk(mempool.hasTx(tx6.hash()));
    });

    it('should dump local TXns to disk', async () => {
        const mempool = new factory.Mempool({testStorage: false});

        const tx = new factory.Transaction(createDummyTx());
        mempool.addLocalTx(tx);

        assert.isOk(stubWrite.calledOnce);
        const [, strJson] = stubWrite.args[0];
        const objSaved = JSON.parse(strJson);
        assert.deepEqual(objSaved, {[tx.getHash()]: tx.encode().toString('hex')});
    });

    it('should load local TXns from disk', async () => {
        const mempool = new factory.Mempool({testStorage: false});

        sinon.restore();
        sinon
            .stub(fs, 'readFileSync')
            .returns(
                '{"0a48cb13f67da62195d60dc2ace499a97ec29537b86bbf161ca6cd1998b006c3": "0a4c0a250a20ed000000000000000000000000000000000000000000000070706e0300000000109307121f095b010000000000001214dc6b50030000000040706e030000000007f5152e180120001220ec6c50030000000088706e03000000007f24aa3e04000000c8726e0300000000"}'
            );

        mempool.loadLocalTxnsFromDisk();

        assert.isOk(Array.isArray(mempool.getLocalTxnHashes()) && mempool.getLocalTxnHashes().length === 1);
    });

    it('should getLocalTxnHashes', async () => {
        const mempool = new factory.Mempool({testStorage: true});

        const tx = new factory.Transaction(createDummyTx());
        mempool.addLocalTx(tx);
        const tx2 = new factory.Transaction(createDummyTx());
        mempool.addLocalTx(tx2);

        assert.deepEqual(mempool.getLocalTxnHashes(), [tx.getHash(), tx2.getHash()]);
    });

    it('should storeBadTxHash', async () => {
        const mempool = new factory.Mempool({testStorage: true});
        const strHash = pseudoRandomBuffer().toString('hex');

        mempool.storeBadTxHash(strHash);
        assert.isOk(mempool.hasTx(strHash));
    });

    it('should add conciliums to preferred', async () => {
        const mempool = new factory.Mempool({testStorage: true});

        mempool.setPreferredConciliums([1, 2]);
        mempool.setPreferredConciliums([1, 2, 2, 4]);

        assert.equal(mempool._setPreferredConciliums.size, 3);
        assert.isOk(mempool._setPreferredConciliums.has(1));
        assert.isOk(mempool._setPreferredConciliums.has(2));
        assert.isOk(mempool._setPreferredConciliums.has(4));
    });

    it('should _calcSize', async () => {
        const mempool = new factory.Mempool({testStorage: true});

        const tx = new factory.Transaction(createDummyTx(undefined, 0));
        mempool.addTx(tx);
        const tx2 = new factory.Transaction(createDummyTx(undefined, 1));
        mempool.addTx(tx2);
        const tx3 = new factory.Transaction(createDummyTx(undefined, 0));
        mempool.addTx(tx3);

        assert.strictEqual(mempool._calcSize(), 3);
    });

    it('should _calcPrefferedSize', async () => {
        const mempool = new factory.Mempool({testStorage: true});
        mempool.setPreferredConciliums([1, 2, 4]);

        const tx = new factory.Transaction(createDummyTx(undefined, 0));
        mempool.addTx(tx);
        const tx2 = new factory.Transaction(createDummyTx(undefined, 1));
        mempool.addTx(tx2);
        const tx3 = new factory.Transaction(createDummyTx(undefined, 0));
        mempool.addTx(tx3);

        assert.strictEqual(mempool._calcPrefferedSize(), 1);
    });

    describe('_purgeMaps', async () => {
        it('should pass for one map ', async () => {
            const mempool = new factory.Mempool({testStorage: true});

            {
                const sampleMap = new Map([
                    [1, 'a'],
                    [2, 'b'],
                    [3, 'c'],
                    [4, 'd']
                ]);
                mempool._purgeMaps([sampleMap], 3);
                assert.equal(sampleMap.size, 3);
            }
            {
                const sampleMap = new Map([
                    [1, 'a'],
                    [2, 'b'],
                    [3, 'c'],
                    [4, 'd']
                ]);
                mempool._purgeMaps([sampleMap], 0);
                assert.equal(sampleMap.size, 0);
            }
            {
                const sampleMap = new Map([
                    [1, 'a'],
                    [2, 'b'],
                    [3, 'c'],
                    [4, 'd']
                ]);
                mempool._purgeMaps([sampleMap], 4);
                assert.equal(sampleMap.size, 4);
            }
        });

        it('should pass proportionally for two map ', async () => {
            const mempool = new factory.Mempool({testStorage: true});

            {
                const sampleMap1 = new Map([
                    [1, 'a'],
                    [2, 'b'],
                    [3, 'c'],
                    [4, 'd']
                ]);
                const sampleMap2 = new Map([[1, 'a']]);
                mempool._purgeMaps([sampleMap1, sampleMap2], 4);
                assert.equal(sampleMap1.size, 3);
                assert.equal(sampleMap2.size, 1);
            }
            {
                const sampleMap1 = new Map([
                    [1, 'a'],
                    [2, 'b'],
                    [3, 'c'],
                    [4, 'd']
                ]);
                const sampleMap2 = new Map([[1, 'a']]);
                mempool._purgeMaps([sampleMap1, sampleMap2], 3);
                assert.equal(sampleMap1.size, 2);
                assert.equal(sampleMap2.size, 1);
            }
            {
                const sampleMap1 = new Map([
                    [1, 'a'],
                    [2, 'b'],
                    [3, 'c'],
                    [4, 'd']
                ]);
                const sampleMap2 = new Map([[1, 'a']]);
                mempool._purgeMaps([sampleMap1, sampleMap2], 2);
                assert.equal(sampleMap1.size, 2);
                assert.equal(sampleMap2.size, 0);
            }
        });
    });

    describe('getContent', async () => {
        it('should get only local TXns hashes', async () => {
            const mempool = new factory.Mempool({testStorage: true});

            const tx = new factory.Transaction(createDummyTx(undefined, 0));
            mempool.addLocalTx(tx);

            const arrHashes = mempool.getContent();

            assert.isOk(Array.isArray(arrHashes) && arrHashes.length === 1);
            assert.equal(tx.getHash(), arrHashes[0]);
        });

        it('should get only non local hashes', async () => {
            const mempool = new factory.Mempool({testStorage: true});

            const tx = new factory.Transaction(createDummyTx(undefined, 0));
            mempool.addTx(tx);

            const arrHashes = mempool.getContent();

            assert.isOk(Array.isArray(arrHashes) && arrHashes.length === 1);
            assert.equal(tx.getHash(), arrHashes[0]);
        });

        it('should get both TXns hashes', async () => {
            const mempool = new factory.Mempool({testStorage: true});

            const tx1 = new factory.Transaction(createDummyTx(undefined, 0));
            mempool.addTx(tx1);

            const tx2 = new factory.Transaction(createDummyTx(undefined, 1));
            mempool.addLocalTx(tx2);

            const arrHashes = mempool.getContent();

            assert.isOk(Array.isArray(arrHashes) && arrHashes.length === 2);
            assert.equal(tx1.getHash(), arrHashes[0]);
            assert.equal(tx2.getHash(), arrHashes[1]);
        });
    });
});
