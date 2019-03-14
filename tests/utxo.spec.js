'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();

const factory = require('./testFactory');
const {arrayEquals} = require('../utils');
const {pseudoRandomBuffer, generateAddress} = require('./testUtil');

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
});
