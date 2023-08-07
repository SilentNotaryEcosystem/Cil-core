'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const Mutex = require('mutex');

const config = require('../config/test.conf');
const TestFactory = require('./testFactory');
const {arrayEquals} = require('../utils');
const {pseudoRandomBuffer, generateAddress} = require('./testUtil');

const factory = new TestFactory(
    {
        testStorage: true,
        mutex: new Mutex(),
        workerSuspended: true,
        bDev: true
    },
    config.constants
);

const createDummyUtxo = (arrIndexes) => {
    const txHash = pseudoRandomBuffer().toString('hex');
    const utxo = new factory.UTXO({txHash});
    const coins = new factory.Coins(10, generateAddress());

    arrIndexes.forEach(idx => utxo.addCoins(idx, coins));

    return {utxo, coins};
};

describe('UTXO', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should NOT create instance', async () => {
        assert.throws(() => new factory.UTXO());
    });

    it('should create instance', async () => {
        const txHash = pseudoRandomBuffer().toString('hex');
        new factory.UTXO({txHash});
    });

    it('should add/get coins', async () => {
        const {utxo, coins} = createDummyUtxo([12]);

        const coins2 = utxo.coinsAtIndex(12);
        assert.isOk(coins2);
        assert.isOk(coins.equals(coins2));
    });

    it('should NOT get coins (wrong index)', async () => {
        const {utxo, coins} = createDummyUtxo([10]);
        assert.throws(() => utxo.coinsAtIndex(12));
    });

    it('should NOT add coins (same idx)', async () => {
        const {utxo, coins} = createDummyUtxo([12]);
        assert.throws(() => utxo.addCoins(12, coins));
    });

    it('should add 3 coins', async () => {
        const {utxo} = createDummyUtxo([12, 0, 431]);

        assert.isOk(utxo.coinsAtIndex(12));
        assert.isOk(utxo.coinsAtIndex(431));
        assert.isOk(utxo.coinsAtIndex(0));
    });

    it('should remove 2 coins', async () => {
        const {utxo} = createDummyUtxo([12, 0, 431]);
        utxo.spendCoins(0);

        assert.isOk(utxo.coinsAtIndex(12));
        assert.isOk(utxo.coinsAtIndex(431));
        assert.isNotOk(utxo.isEmpty());
        assert.throws(() => utxo.coinsAtIndex(0));

        utxo.spendCoins(431);

        assert.isOk(utxo.coinsAtIndex(12));
        assert.isNotOk(utxo.isEmpty());
        assert.throws(() => utxo.coinsAtIndex(0));
        assert.throws(() => utxo.coinsAtIndex(431));

        utxo.spendCoins(12);
        assert.isOk(utxo.isEmpty());
    });

    it('should get indexes', async () => {
        const {utxo} = createDummyUtxo([12, 431]);

        assert.isOk(Array.isArray(utxo.getIndexes()));
        assert.isOk(arrayEquals(utxo.getIndexes(), [12, 431]));
    });

    it('should clone UTXO', async () => {
        const {utxo} = createDummyUtxo([12, 0, 431]);
        const clone = utxo.clone();

        // spend coins in original
        utxo.spendCoins(0);
        assert.isOk(arrayEquals(utxo.getIndexes(), [12, 431]));

        // it shouldn't affect copy
        assert.isOk(arrayEquals(clone.getIndexes(), [12, 0, 431]));
        assert.isOk(clone.coinsAtIndex(0));

    });

    it('should pass EQUALITY ', async () => {
        const {utxo} = createDummyUtxo([12, 0, 431]);
        const clone = utxo.clone();
        assert.isOk(utxo.equals(clone));
        assert.isOk(clone.equals(utxo));
    });

    it('should fail EQUALITY (indexes)', async () => {
        const {utxo} = createDummyUtxo([12, 0, 431]);
        const clone = utxo.clone();
        clone.spendCoins(0);
        assert.isNotOk(utxo.equals(clone));
        assert.isNotOk(clone.equals(utxo));
    });

    it('should fail EQUALITY (coins)', async () => {
        const {utxo} = createDummyUtxo([12, 0, 431]);
        const {utxo: clone} = createDummyUtxo([12, 0, 431]);
        assert.isNotOk(utxo.equals(clone));
        assert.isNotOk(clone.equals(utxo));
    });

    it('should encode/decode', async () => {
        const {utxo} = createDummyUtxo([12, 431]);

        const buffData = utxo.encode();
        assert.isOk(buffData.length);

        const restoredUtxo = new factory.UTXO({txHash: utxo.getTxHash(), data: buffData});
        assert.isOk(restoredUtxo.equals(utxo));
    });

    it('should count coins in UTXO', async () => {
        const {utxo, coins} = createDummyUtxo([12, 0, 431]);

        assert.equal(utxo.amountOut(), coins.getAmount() * utxo.getIndexes().length);

        // spend and check again!
        utxo.spendCoins(0);
        assert.equal(utxo.amountOut(), coins.getAmount() * utxo.getIndexes().length);
    });

    it('should convert to Object', async () => {
        const {utxo} = createDummyUtxo([12, 0, 431]);

        const objResult = utxo.toObject();
        assert.isOk(arrayEquals(Object.keys(objResult).map(key => parseInt(key)), [12, 0, 431]));
        assert.isOk(Object.keys(objResult).every(key => typeof objResult[key].amount === 'number' &&
                                                        typeof objResult[key].receiverAddr === 'string'));
    });

    it('should getOutputsForAddress', async () => {
        const addr1 = generateAddress();
        const addr2 = generateAddress();

        const utxo = new factory.UTXO({txHash: pseudoRandomBuffer().toString('hex')});
        utxo.addCoins(0, new factory.Coins(10, addr1));
        utxo.addCoins(2, new factory.Coins(10, addr2));
        utxo.addCoins(3, new factory.Coins(10, addr1));

        {
            const arrResults = utxo.getOutputsForAddress(addr1);

            assert.equal(arrResults.length, 2);
            assert.equal(arrResults[0][0], 0);
            assert.equal(arrResults[1][0], 3);
        }
        {
            const arrResults = utxo.getOutputsForAddress(addr2.toString('hex'));

            assert.equal(arrResults.length, 1);
            assert.equal(arrResults[0][0], 2);
        }
    });

    it('should get 3 receivers', async () => {
        const utxo = new factory.UTXO({txHash: 'A'.repeat(64)});
        const coins1 = new factory.Coins(10, generateAddress());
        utxo.addCoins(0, coins1);
        const coins2 = new factory.Coins(10, generateAddress());
        utxo.addCoins(1, coins2);
        const coins3 = new factory.Coins(10, generateAddress());
        utxo.addCoins(2, coins3);
        utxo.addCoins(3, coins3);
        utxo.addCoins(4, coins3);

        const arrResult = utxo.getReceivers();

        assert.isOk(Array.isArray(arrResult));
        assert.isOk(arrResult.every(e => typeof e === 'string' && e.length === 40));
        assert.equal(arrResult.length, 3);
    });

    it('should filterOutputsForAddress', async () => {
        const addr = generateAddress();
        const coins = new factory.Coins(1e5, addr);

        {
            const hash1 = pseudoRandomBuffer().toString('hex');
            const coinsOther = new factory.Coins(1e5, generateAddress());

            const utxo1 = new factory.UTXO({txHash: hash1});
            utxo1.addCoins(0, coins);
            utxo1.addCoins(3, coinsOther);

            // --------
            const utxoFiltered = utxo1.filterOutputsForAddress(addr);

            assert.isOk(utxoFiltered.coinsAtIndex(0));
            assert.throws(() => utxoFiltered.coinsAtIndex(3));
        }
        {
            const hash2 = pseudoRandomBuffer().toString('hex');
            const utxo2 = new factory.UTXO({txHash: hash2});
            utxo2.addCoins(5, coins);
            utxo2.addCoins(2, coins);

            // --------
            const utxoFiltered = utxo2.filterOutputsForAddress(addr);

            assert.isOk(utxoFiltered.equals(utxo2));
        }
    });
});
