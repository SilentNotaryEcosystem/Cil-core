'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('./testFactory');
const {arrayEquals} = require('../utils');
const {pseudoRandomBuffer, createNonMergeablePatch, generateAddress} = require('./testUtil');

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
        new factory.PatchDB(0);
    });

    it('should add coins to same UTXO', async () => {
        const patch = new factory.PatchDB(0);
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
        const patch = new factory.PatchDB(0);
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
        const patch = new factory.PatchDB(0);
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

    it('should MERGE patches (source is empty)', async () => {
        const patch = new factory.PatchDB(0);
        const utxo = createUtxo([12, 0, 431]);

        const patch2 = new factory.PatchDB(2);
        const strHash = pseudoRandomBuffer().toString('hex');
        patch2.createCoins(strHash, 17, utxo.coinsAtIndex(12));
        patch2.spendCoins(utxo, 0, pseudoRandomBuffer());

        const resultPatch = patch.merge(patch2);

        assert.isOk(resultPatch.getUtxo(utxo.getTxHash()));
        assert.isOk(resultPatch.getUtxo(strHash));
    });

    it('should MERGE patches (param is empty)', async () => {
        const patch = new factory.PatchDB(0);
        const utxo = createUtxo([12, 0, 431]);

        const strHash = pseudoRandomBuffer().toString('hex');
        patch.createCoins(strHash, 17, utxo.coinsAtIndex(12));
        patch.spendCoins(utxo, 0, pseudoRandomBuffer());

        const resultPatch = patch.merge(new factory.PatchDB(0));

        assert.isOk(resultPatch.getUtxo(utxo.getTxHash()));
        assert.isOk(resultPatch.getUtxo(strHash));
        assert.isOk(resultPatch.getUtxo(strHash) instanceof factory.UTXO);
    });

    it('should MERGE patches (different outputs same spending TX)', async () => {
        const patch = new factory.PatchDB(0);
        const utxo = createUtxo([12, 0, 431]);
        const spendingTx = pseudoRandomBuffer();

        patch.spendCoins(utxo, 12, spendingTx);

        const patch2 = new factory.PatchDB(0);
        patch2.spendCoins(utxo, 0, spendingTx);

        const mergedPatch = patch.merge(patch2);

        const mapSpentOutputs = mergedPatch._getSpentOutputs(utxo.getTxHash());
        assert.isOk(mapSpentOutputs);
        assert.isOk(arrayEquals(Array.from(mapSpentOutputs.keys()), [0, 12]));

        const resultUtxo = mergedPatch.getUtxo(utxo.getTxHash());
        assert.isOk(resultUtxo);
        assert.isOk(resultUtxo.coinsAtIndex(431));
        assert.throws(() => resultUtxo.coinsAtIndex(0));
        assert.throws(() => resultUtxo.coinsAtIndex(12));
    });

    it('should MERGE patches (same outputs same spending TX)', async () => {
        const patch = new factory.PatchDB(12);
        const patch2 = new factory.PatchDB(0);

        const utxo = createUtxo([12, 0, 431]);
        const spendingTx = pseudoRandomBuffer();
        patch.spendCoins(utxo.clone(), 12, spendingTx);
        patch2.spendCoins(utxo.clone(), 12, spendingTx);

        patch.merge(patch2);
    });

    it('should fail MERGE patches (same outputs different spending TX)', async () => {
        const patch = new factory.PatchDB(12);
        const patch2 = new factory.PatchDB(12);
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

    it('should PURGE patch (complete removal, since equal)', async () => {
        const patch = new factory.PatchDB(0);

        const utxo = createUtxo([12, 0, 431]);
        const creatingTx = pseudoRandomBuffer().toString('hex');
        patch.createCoins(creatingTx, 17, utxo.coinsAtIndex(12));
        const spendingTx = pseudoRandomBuffer().toString('hex');
        patch.spendCoins(utxo, 12, spendingTx);

        const mergedPatch = patch.merge(new factory.PatchDB(0));
        mergedPatch.purge(patch);

        assert.isNotOk(mergedPatch.getUtxo(utxo.getTxHash()));
        assert.isNotOk(mergedPatch.getUtxo(creatingTx));
        assert.isNotOk(mergedPatch.getCoins().size);
    });

    it('should PURGE patch (no changes, since UTXO modified)', async () => {
        const patch = new factory.PatchDB(0);

        const utxo = createUtxo([12, 0, 431]);
        const spendingTx = pseudoRandomBuffer().toString('hex');
        patch.spendCoins(utxo, 12, spendingTx);

        const mergedPatch = patch.merge(new factory.PatchDB(1));
        mergedPatch.setGroupId(1);
        mergedPatch.spendCoins(utxo, 0, spendingTx);

        const level3Patch = mergedPatch.merge(new factory.PatchDB(0));
        const level3PatchSize = level3Patch.getCoins().size;
        level3Patch.purge(patch);

        assert.isOk(level3Patch.getCoins().size === level3PatchSize);
    });

    it('should get patch COMPLEXITY', async () => {
        const patch = new factory.PatchDB(0);
        const utxo = createUtxo([12, 0, 431]);
        const spendingTx = pseudoRandomBuffer().toString('hex');
        patch.spendCoins(utxo, 12, spendingTx);

        const mergedPatch = patch.merge(new factory.PatchDB(3));
        mergedPatch.spendCoins(utxo, 0, spendingTx);

        assert.isOk(patch.getComplexity() === 1);
        assert.isOk(mergedPatch.getComplexity() === 2);
    });

    it('should create patch that woldn\'t merge', async () => {
        const patch = new factory.PatchDB(0);
        const patchThatWouldntMerge = createNonMergeablePatch(factory);

        assert.throws(() => patch.merge(patchThatWouldntMerge));
        assert.throws(() => patchThatWouldntMerge.merge(patch));
    });

    it('should set level', async () => {
        const groupId = 12;
        const patch = new factory.PatchDB(groupId);
        assert.equal(patch._mapGroupLevel.get(groupId), 1);
    });

    it('should get level', async () => {
        const patch = new factory.PatchDB(0);
        const patchMerged = patch.merge(new factory.PatchDB(1));

        assert.equal(patchMerged._mapGroupLevel.get(0), 1);
        assert.equal(patchMerged._mapGroupLevel.get(1), 1);

        patchMerged.setGroupId(1);
        assert.equal(patchMerged._mapGroupLevel.get(1), 2);

        const patchMergedAgain = patchMerged.merge(new factory.PatchDB(1));
        assert.equal(patchMergedAgain._mapGroupLevel.get(0), 1);
        assert.equal(patchMergedAgain._mapGroupLevel.get(1), 2);

        patchMergedAgain.setGroupId(1);
        assert.equal(patchMergedAgain._mapGroupLevel.get(1), 3);
    });

    it('should set/get contract', async () => {
        const patch = new factory.PatchDB(0);
        const contractAddr = generateAddress().toString('hex');
        const strCode = 'let a=10;';
        const objData = {a: 10};
        patch.setContract(contractAddr, objData, strCode);

        const contract = patch.getContract(contractAddr);
        assert.isOk(contract);
        assert.equal(contract.getCode(), strCode);
        assert.deepEqual(contract.getData(), objData);
    });

    it('should have contract in merge result', async () => {
        const contractAddr = generateAddress().toString('hex');
        const objData = {a: 10};

        const patch = new factory.PatchDB(0);
        patch.setContract(contractAddr, objData, '');

        const patchDerived = patch.merge(new factory.PatchDB(0));
        patchDerived.setGroupId(1);
        const contract = patchDerived.getContract(contractAddr);

        assert.isOk(contract);
        assert.deepEqual(contract.getData(), objData);
    });

    it('should fail to merge patches (contract belongs to different groups)', async () => {
        const contractAddr = generateAddress().toString('hex');

        const patch1 = new factory.PatchDB(0);
        patch1.setContract(contractAddr, {}, '');

        const patch2 = new factory.PatchDB(1);
        patch2.setContract(contractAddr, {}, '');

        assert.throws(_ => patch1.merge(patch2));
    });

    it('should merge 2 patches with contract data', async () => {
        const contractAddr = generateAddress().toString('hex');
        const patch = new factory.PatchDB(0);
        patch.setContract(contractAddr, {value: 1}, '');

        const patchDerived = patch.merge(new factory.PatchDB(0));
        patchDerived.setGroupId(0);
        patchDerived.setContract(contractAddr, {value: 2}, '');

        {
            const patchMerged = patch.merge(patchDerived);
            const contract = patchMerged.getContract(contractAddr);
            assert.equal(contract.getData().value, 2);
        }

        {
            const patchMerged = patchDerived.merge(patch);
            const contract = patchMerged.getContract(contractAddr);
            assert.equal(contract.getData().value, 2);
        }
    });

    it('should check contract data separation', async () => {
        const contractAddr = generateAddress().toString('hex');

        const patch = new factory.PatchDB(0);
        patch.setContract(contractAddr, {value: 1}, '');

        {
            const patchDerived = patch.merge(new factory.PatchDB(0));
            const contract2 = patchDerived.getContract(contractAddr);
            contract2.getData().value = 12;

            const contract = patch.getContract(contractAddr);
            assert.equal(contract.getData().value, 1);
        }

        {
            const patchDerived = new factory.PatchDB(0).merge(patch);
            const contract2 = patchDerived.getContract(contractAddr);
            contract2.getData().value = 12;

            const contract = patch.getContract(contractAddr);
            assert.equal(contract.getData().value, 1);
        }
    });

    it('should PURGE contract data (unchanged between blocks)', async () => {
        const contractAddr = generateAddress().toString('hex');

        const patch = new factory.PatchDB(0);
        patch.setContract(contractAddr, {value: 1}, '');

        const patchDerived = patch.merge(new factory.PatchDB(0));
        patchDerived.setGroupId(1);
        patchDerived.purge(patch);

        assert.isNotOk(patchDerived.getContract(contractAddr));
    });

    it('should KEEP contract data (since data was changed)', async () => {
        const contractAddr = generateAddress().toString('hex');

        const patch = new factory.PatchDB(0);
        patch.setContract(contractAddr, {value: 1}, '');

        const patchDerived = patch.merge(new factory.PatchDB(0));
        patchDerived.setGroupId(0);
        patch.setContract(contractAddr, {value: 2}, '');
        patchDerived.purge(patch);

        assert.isOk(patchDerived.getContract(contractAddr));
    });

    it('should save receipt to patch', async () => {
        const patch = new factory.PatchDB(0);
        const txHash = pseudoRandomBuffer().toString('hex');
        patch.setReceipt(txHash, new factory.TxReceipt({}));

        assert.equal(Array.from(patch.getReceipts()).length, 1);
    });

    it('should MERGE patches with RECEIPTS', async () => {
        const patch = new factory.PatchDB(0);
        const patch2 = new factory.PatchDB(0);

        {
            const txHash = pseudoRandomBuffer().toString('hex');
            patch.setReceipt(txHash, new factory.TxReceipt({}));
            patch2.setReceipt(txHash, new factory.TxReceipt({}));
        }

        {
            const txHash = pseudoRandomBuffer().toString('hex');
            patch2.setReceipt(txHash, new factory.TxReceipt({}));
        }

        // now patches has one intersection
        const mergedPatch = patch.merge(patch2);
        assert.equal(Array.from(mergedPatch.getReceipts()).length, 2);
    });

    it('should PURGE patches with RECEIPTS', async () => {
        const patch = new factory.PatchDB(0);
        const patch2 = new factory.PatchDB(0);

        {
            const txHash = pseudoRandomBuffer().toString('hex');
            patch.setReceipt(txHash, new factory.TxReceipt({}));
            patch2.setReceipt(txHash, new factory.TxReceipt({}));
        }

        {
            const txHash = pseudoRandomBuffer().toString('hex');
            patch2.setReceipt(txHash, new factory.TxReceipt({}));
        }

        // now patches has one intersection
        patch2.purge(patch);
        assert.equal(Array.from(patch2.getReceipts()).length, 1);
    });

});
