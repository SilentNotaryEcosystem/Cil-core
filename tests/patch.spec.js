'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();

const factory = require('./testFactory');
const {arrayEquals} = require('../utils');
const {createDummyTx, pseudoRandomBuffer} = require('./testUtil');

const createUtxo = (arrIndexes) => {
    const txHash = pseudoRandomBuffer(32).toString('hex');

    const utxo = new factory.UTXO({txHash});
    const coins = new factory.Coins(1000, Buffer.allocUnsafe(100));
    arrIndexes.forEach(idx => utxo.addCoins(idx, coins));

    return utxo;
};

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
        const spendingTx = pseudoRandomBuffer(32).toString('hex');

        const utxo = createUtxo([12, 0, 431]);
        const utxo2 = createUtxo([12, 0]);

        patch.spendCoins(utxo, 12, spendingTx);
        patch.spendCoins(utxo, 0, spendingTx);
        patch.spendCoins(utxo, 431, spendingTx);
        patch.spendCoins(utxo2, 12, spendingTx);

        assert.isOk(patch.getCoins());
        assert.equal(patch.getCoins().size, 2);

        const utxoPatched = patch.getUtxo(utxo.getTxHash());
        const utxo2Patched = patch.getUtxo(utxo2.getTxHash());

        assert.isOk(utxoPatched.isEmpty());
        assert.isNotOk(utxo2Patched.isEmpty());

        assert.isOk(utxo2Patched.coinsAtIndex(0));
        assert.throws(() => utxo2Patched.coinsAtIndex(12));
    });

    it('should MERGE patches (different outputs same spending TX)', async () => {
        const patch = new factory.PatchDB();
        const utxo = createUtxo([12, 0, 431]);
        const spendingTx = pseudoRandomBuffer();

        patch.spendCoins(utxo, 12, spendingTx);

        const patch2 = new factory.PatchDB();
        patch2.spendCoins(utxo, 0, spendingTx);

        const mergedPatch = patch.merge(patch2);

        const mapSpentOutputs = mergedPatch._getSpentOutputs(utxo.getTxHash());
        assert.isOk(mapSpentOutputs);
        assert.isOk(arrayEquals(Array.from(mapSpentOutputs.keys()), [0, 12]));

    });

    it('should MERGE patches (same outputs same spending TX)', async () => {
        const patch = new factory.PatchDB();
        const patch2 = new factory.PatchDB();

        const utxo = createUtxo([12, 0, 431]);
        const spendingTx = pseudoRandomBuffer();
        patch.spendCoins(utxo.clone(), 12, spendingTx);
        patch2.spendCoins(utxo.clone(), 12, spendingTx);

        patch.merge(patch2);
    });

    it('should fail MERGE patches (same outputs different spending TX)', async () => {
        const patch = new factory.PatchDB();
        const patch2 = new factory.PatchDB();
        const utxo = createUtxo([12, 0, 431]);

        patch.spendCoins(utxo.clone(), 12, pseudoRandomBuffer());
        patch2.spendCoins(utxo.clone(), 12, pseudoRandomBuffer());

        try {
            patch.merge(patch2);
        } catch (e) {
            return;
        }
        throw ('Unexpected success');
    });
});
