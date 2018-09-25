'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const debug = require('debug')('storage:test');

const factory = require('./testFactory');
const {createDummyTx, pseudoRandomBuffer} = require('./testUtil');

describe('Storage tests', () => {
    before(async function() {
        await factory.asyncLoad();
    });

    it('should create storage', async () => {
        const wrapper = () => new factory.Storage({});
        assert.doesNotThrow(wrapper);
    });

    it('should store group definitions', async () => {
        const def1 = factory.WitnessGroupDefinition.create('test', 0, [Buffer.from('public1'), Buffer.from('public2')]);
        const def2 = factory.WitnessGroupDefinition.create('test2', 1,
            [Buffer.from('public2'), Buffer.from('public3')]
        );

        const storage = new factory.Storage({arrTestDefinition: [def1, def2]});

        {
            const arrDefs = await storage.getGroupsByKey(Buffer.from('public1'));
            assert.isOk(Array.isArray(arrDefs));
            assert.equal(arrDefs.length, 1);
        }

        {
            const arrDefs = await storage.getGroupsByKey(Buffer.from('public2'));
            assert.isOk(Array.isArray(arrDefs));
            assert.equal(arrDefs.length, 2);
        }

    });

    it('should save block', async () => {
        const block = new factory.Block(0);
        const tx = new factory.Transaction(createDummyTx());
        block.addTx(tx);

        const storage = new factory.Storage({});
        await storage.saveBlock(block);
    });

    it('should find block in storage', async () => {
        const block = new factory.Block(0);
        const tx = new factory.Transaction(createDummyTx());
        block.addTx(tx);

        const storage = new factory.Storage({});
        await storage.saveBlock(block);

        assert.isOk(await storage.hasBlock(block.hash()));
    });

    it('should THROWS find block in storage (param check failed)', async () => {
        const storage = new factory.Storage({});

        try {
            await storage.hasBlock('133');
        } catch (e) {
            return;
        }
        throw ('Unexpected success');
    });

    it('should NOT find block in storage', async () => {
        const storage = new factory.Storage({});
        assert.isNotOk(await storage.hasBlock(Buffer.allocUnsafe(32)));
    });

    it('should NOT find block in storage', async () => {
        const storage = new factory.Storage({});
        assert.isNotOk(await storage.hasBlock(Buffer.allocUnsafe(32).toString('hex')));
    });

    it('should get saved block', async () => {
        const block = new factory.Block(0);
        const tx = new factory.Transaction(createDummyTx());
        block.addTx(tx);

        const storage = new factory.Storage({});
        await storage.saveBlock(block);

        const gotBlock = await storage.getBlock(block.hash());

        assert.isOk(gotBlock.txns);
        const rTx = new factory.Transaction(gotBlock.txns[0]);
        assert.isOk(rTx.equals(tx));
    });

    it('should apply "addCoins" patch to empty storage (like genezis)', async () => {
        const storage = new factory.Storage({});

        const patch = new factory.PatchDB();
        const txHash = pseudoRandomBuffer().toString('hex');
        const coins = new factory.Coins(100, pseudoRandomBuffer(17));
        patch.createCoins(txHash, 12, coins);
        patch.createCoins(txHash, 0, coins);
        patch.createCoins(txHash, 80, coins);

        const txHash2 = pseudoRandomBuffer().toString('hex');
        const coins2 = new factory.Coins(200, pseudoRandomBuffer(17));
        patch.createCoins(txHash2, 22, coins2);

        await storage.applyPatch(patch);

        const utxo1 = await storage.getUtxo(txHash);
        assert.isOk(utxo1);
        assert.isOk(utxo1.coinsAtIndex(12));

        const utxo2 = await storage.getUtxo(txHash2);
        assert.isOk(utxo2);
        assert.isOk(utxo2.coinsAtIndex(22));
    });

    it('should apply "spendCoins" patch', async () => {
        const storage = new factory.Storage({});

        // create coins that we plan to spend
        const patch = new factory.PatchDB();
        const txHash = pseudoRandomBuffer().toString('hex');
        const coins = new factory.Coins(100, pseudoRandomBuffer(17));
        patch.createCoins(txHash, 12, coins);
        patch.createCoins(txHash, 0, coins);
        patch.createCoins(txHash, 80, coins);

        const txHash2 = pseudoRandomBuffer().toString('hex');
        const coins2 = new factory.Coins(200, pseudoRandomBuffer(17));
        patch.createCoins(txHash2, 22, coins2);

        await storage.applyPatch(patch);

        // now spend it
        {
            const spendPatch = new factory.PatchDB();

            // 2 of 3 from first utxo
            const utxo = await storage.getUtxo(txHash);
            spendPatch.spendCoins(utxo, 12);
            spendPatch.spendCoins(utxo, 80);

            // 1 of 1 from first utxo2
            const utxo2 = await storage.getUtxo(txHash2);
            spendPatch.spendCoins(utxo2, 22);

            await storage.applyPatch(spendPatch);
        }
        {
            // we should have only 1 output in txHash rest are spent
            const utxo = await storage.getUtxo(txHash);
            assert.isOk(utxo.coinsAtIndex(0));
            assert.throws(() => utxo.coinsAtIndex(12));
            assert.throws(() => utxo.coinsAtIndex(80));

            // empty utxo removed from DB
            try {
                await storage.getUtxo(txHash2);
            } catch (e) {
                return;
            }
            throw new Error('Unexpected success');
        }
    });

    it('should get UTXOs from DB as map', async () => {
        const storage = new factory.Storage({});

        const patch = new factory.PatchDB();
        const txHash = pseudoRandomBuffer().toString('hex');
        const txHash2 = pseudoRandomBuffer().toString('hex');
        const txHash3 = pseudoRandomBuffer().toString('hex');
        const coins = new factory.Coins(100, pseudoRandomBuffer(17));

        patch.createCoins(txHash, 12, coins);
        patch.createCoins(txHash2, 0, coins);
        patch.createCoins(txHash3, 80, coins);

        await storage.applyPatch(patch);

        const mapUtxos = await storage.getUtxosCreateMap([txHash, txHash2, txHash3]);

        assert.isOk(mapUtxos);
        assert.isOk(mapUtxos[txHash.toString('hex')]);
        assert.isOk(mapUtxos[txHash2.toString('hex')]);
        assert.isOk(mapUtxos[txHash3.toString('hex')]);
    });

});
