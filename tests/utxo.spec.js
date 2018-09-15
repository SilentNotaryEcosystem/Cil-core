'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();

const factory = require('./testFactory');

describe('PatchDB', () => {
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
        const txHash = Buffer.allocUnsafe(32).toString('hex');
        new factory.UTXO({txHash});
    });

    it('should add/get coins', async () => {
        const txHash = Buffer.allocUnsafe(32).toString('hex');
        const utxo = new factory.UTXO({txHash});
        const coins = new factory.Coins(10, Buffer.allocUnsafe(100));

        utxo.addCoins(12, coins);
        const coins2 = utxo.coinsAtIndex(12);
        assert.isOk(coins2);
        assert.isOk(coins.getAmount(), coins2.getAmount());
    });

    it('should NOT get coins (wrong index)', async () => {
        const txHash = Buffer.allocUnsafe(32).toString('hex');
        const utxo = new factory.UTXO({txHash});
        const coins = new factory.Coins(10, Buffer.allocUnsafe(100));

        utxo.addCoins(10, coins);
        assert.throws(() => utxo.coinsAtIndex(12));
    });

    it('should NOT add coins (same idx)', async () => {
        const txHash = Buffer.allocUnsafe(32).toString('hex');
        const utxo = new factory.UTXO({txHash});
        const coins = new factory.Coins(10, Buffer.allocUnsafe(100));

        utxo.addCoins(12, coins);
        assert.throws(() => utxo.addCoins(12, coins));
    });

    it('should add 3 coins', async () => {
        const txHash = Buffer.allocUnsafe(32).toString('hex');
        const utxo = new factory.UTXO({txHash});
        const coins = new factory.Coins(10, Buffer.allocUnsafe(100));

        utxo.addCoins(12, coins);
        utxo.addCoins(0, coins);
        utxo.addCoins(431, coins);

        assert.isOk(utxo.coinsAtIndex(12));
        assert.isOk(utxo.coinsAtIndex(431));
        assert.isOk(utxo.coinsAtIndex(0));
    });

});
