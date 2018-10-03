'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();

const factory = require('./testFactory');
const {createDummyTx, pseudoRandomBuffer} = require('./testUtil');

describe('PatchDB', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create instance', async () => {
        new factory.PatchDB();
    });

    it('should add coins to same UTXO', async () => {
        const patch = new factory.PatchDB();
        const txHash = pseudoRandomBuffer(32).toString('hex');
        const coins = new factory.Coins(10, pseudoRandomBuffer(100));
        patch.createCoins(txHash, 0, coins);
        patch.createCoins(txHash, 2, coins);

        const mapCoinsToAdd = patch.getCoins();
        assert.isOk(mapCoinsToAdd);
        assert.isOk(mapCoinsToAdd.get(txHash));
        assert.equal(mapCoinsToAdd.size, 1);
        assert.isOk(patch.getUtxo(txHash));
    });

    it('should add coins to different UTXOs', async () => {
        const patch = new factory.PatchDB();
        const txHash = pseudoRandomBuffer(32).toString('hex');
        const txHash2 = pseudoRandomBuffer(32).toString('hex');

        const coins = new factory.Coins(10, pseudoRandomBuffer(11));
        patch.createCoins(txHash, 0, coins);
        patch.createCoins(txHash2, 2, coins);

        const mapCoinsToAdd = patch.getCoins();
        assert.isOk(mapCoinsToAdd);
        assert.isOk(mapCoinsToAdd.get(txHash));
        assert.isOk(mapCoinsToAdd.get(txHash2));
        assert.equal(mapCoinsToAdd.size, 2);
    });

    it('should remove coins', async () => {
        const patch = new factory.PatchDB();
        const txHash = pseudoRandomBuffer(32).toString('hex');
        const txHash2 = pseudoRandomBuffer(32).toString('hex');

        const utxo = new factory.UTXO({txHash});
        const coins = new factory.Coins(1000, Buffer.allocUnsafe(100));
        utxo.addCoins(12, coins);
        utxo.addCoins(0, coins);
        utxo.addCoins(431, coins);

        const utxo2 = new factory.UTXO({txHash: txHash2});
        const coins2 = new factory.Coins(20000, Buffer.allocUnsafe(100));
        utxo2.addCoins(12, coins2);
        utxo2.addCoins(0, coins2);

        patch.spendCoins(utxo, 12);
        patch.spendCoins(utxo, 0);
        patch.spendCoins(utxo, 431);
        patch.spendCoins(utxo2, 12);

        assert.isOk(patch.getCoins());
        assert.equal(patch.getCoins().size, 2);

        const utxoPatched = patch.getUtxo(txHash);
        const utxo2Patched = patch.getUtxo(txHash2);

        assert.isOk(utxoPatched.isEmpty());
        assert.isNotOk(utxo2Patched.isEmpty());

        assert.isOk(utxo2Patched.coinsAtIndex(0));
        assert.throws(() => utxo2Patched.coinsAtIndex(12));
    });
});
