'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const debug = require('debug')('storage:test');

const factory = require('./testFactory');
const {createDummyTx, pseudoRandomBuffer, createDummyBlock, generateAddress} = require('./testUtil');
const {timestamp, arrayEquals} = require('../utils');

const createBlockInfo = () => {
    return new factory.BlockInfo({
        parentHashes: [],
        merkleRoot: pseudoRandomBuffer(),
        witnessGroupId: 0,
        timestamp: timestamp(),
        version: 1
    });
};

describe('Storage tests', () => {
    before(async function() {
        await factory.asyncLoad();
    });

    it('should create storage', async () => {
        const wrapper = () => new factory.Storage({});
        assert.doesNotThrow(wrapper);
    });

    it('should store group definitions', async () => {
        const def1 = factory.WitnessGroupDefinition.create(0, [Buffer.from('public1'), Buffer.from('public2')]);
        const def2 = factory.WitnessGroupDefinition.create(
            1,
            [Buffer.from('public2'), Buffer.from('public3')]
        );

        const storage = new factory.Storage({arrTestDefinition: [def1, def2]});

        {
            const arrDefs = await storage.getWitnessGroupsByKey(Buffer.from('public1'));
            assert.isOk(Array.isArray(arrDefs));
            assert.equal(arrDefs.length, 1);
        }

        {
            const arrDefs = await storage.getWitnessGroupsByKey(Buffer.from('public2'));
            assert.isOk(Array.isArray(arrDefs));
            assert.equal(arrDefs.length, 2);
        }

    });

    it('should save block', async () => {
        const block = createDummyBlock(factory);
        const storage = new factory.Storage({});
        await storage.saveBlock(block);
    });

    it('should find block in storage', async () => {
        const block = createDummyBlock(factory);
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
        const block = createDummyBlock(factory);
        const storage = new factory.Storage({});
        await storage.saveBlock(block);

        const gotBlock = await storage.getBlock(block.hash());

        assert.isOk(gotBlock.txns);
        const rTx = new factory.Transaction(gotBlock.txns[0]);
    });

    it('should apply "addCoins" patch to empty storage (like genesis)', async () => {
        const storage = new factory.Storage({});

        const patch = new factory.PatchDB(0);
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
        const patch = new factory.PatchDB(0);
        const txHash = pseudoRandomBuffer().toString('hex');
        const coins = new factory.Coins(100, pseudoRandomBuffer(17));
        patch.createCoins(txHash, 12, coins);
        patch.createCoins(txHash, 0, coins);
        patch.createCoins(txHash, 80, coins);

        const txHash2 = pseudoRandomBuffer().toString('hex');
        const coins2 = new factory.Coins(200, pseudoRandomBuffer(17));
        patch.createCoins(txHash2, 22, coins2);

        const spendingTx = pseudoRandomBuffer();

        await storage.applyPatch(patch);

        // now spend it
        {
            const spendPatch = new factory.PatchDB(0);

            // 2 of 3 from first utxo
            const utxo = await storage.getUtxo(txHash);
            spendPatch.spendCoins(utxo, 12, spendingTx);
            spendPatch.spendCoins(utxo, 80, spendingTx);

            // 1 of 1 from first utxo2
            const utxo2 = await storage.getUtxo(txHash2);
            spendPatch.spendCoins(utxo2, 22, spendingTx);

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

        const patch = new factory.PatchDB(0);
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

    // if we find UTXO with same hash
    // @see bip30 https://github.com/bitcoin/bitcoin/commit/a206b0ea12eb4606b93323268fc81a4f1f952531)
    it('should find TX COLLISION', async () => {
        const storage = new factory.Storage({});

        const patch = new factory.PatchDB(0);

        const txHash = pseudoRandomBuffer().toString('hex');
        const coins = new factory.Coins(100, pseudoRandomBuffer(17));
        patch.createCoins(txHash, 12, coins);

        await storage.applyPatch(patch);

        try {
            await storage.checkTxCollision([txHash]);
        } catch (e) {
            return;
        }
        throw ('Unexpected success');
    });

    it('should NOT find TX COLLISION', async () => {
        const storage = new factory.Storage({});

        const patch = new factory.PatchDB(0);

        const txHash = pseudoRandomBuffer().toString('hex');
        const coins = new factory.Coins(100, pseudoRandomBuffer(17));
        patch.createCoins(txHash, 12, coins);

        await storage.applyPatch(patch);
        await storage.checkTxCollision([pseudoRandomBuffer().toString('hex')]);
    });

    it('should SET/GET BlockInfo', async () => {
        const storage = new factory.Storage({});
        const blockInfo = createBlockInfo();
        await storage.saveBlockInfo(blockInfo);
        const result = await storage.getBlockInfo(blockInfo.getHash());

        // just check
        assert.isOk(blockInfo.getHeader().merkleRoot.equals(result.getHeader().merkleRoot));
    });

    it('should store LAST_APPLIED_BLOCKS', async () => {
        const storage = new factory.Storage({});
        const block1 = createDummyBlock(factory, 0);
        const block2 = createDummyBlock(factory, 1);
        const block3 = createDummyBlock(factory, 10);

        await storage.saveBlock(block1);
        await storage.saveBlock(block2);
        await storage.saveBlock(block3);

        const arrLastBlocks = [block2.getHash(), block1.getHash(), block3.getHash()];
        await storage.updateLastAppliedBlocks(arrLastBlocks);

        assert.isOk(arrayEquals(await storage.getLastAppliedBlockHashes(), arrLastBlocks));
    });

    it('should REPLACE LAST_APPLIED_BLOCKS', async () => {
        const storage = new factory.Storage({});
        const block1 = createDummyBlock(factory, 0);
        const block2 = createDummyBlock(factory, 1);
        const block3 = createDummyBlock(factory, 10);

        // save them
        await storage.saveBlock(block1);
        await storage.saveBlock(block2);
        await storage.saveBlock(block3);

        const arrLastBlocks = [block2.getHash(), block1.getHash(), block3.getHash()];
        await storage.updateLastAppliedBlocks(arrLastBlocks);

        // replace group 1 & 10 with new blocks
        const block4 = createDummyBlock(factory, 1);
        const block5 = createDummyBlock(factory, 10);

        // and add new for group 5
        const block6 = createDummyBlock(factory, 5);

        // save them
        await storage.saveBlock(block4);
        await storage.saveBlock(block5);
        await storage.saveBlock(block6);

        await storage.updateLastAppliedBlocks([block4.getHash(), block5.getHash(), block6.getHash()]);

        const arrExpected = [block1.getHash(), block4.getHash(), block5.getHash(), block6.getHash()];
        assert.isOk(arrayEquals(await storage.getLastAppliedBlockHashes(), arrExpected));
    });

    it('should removeBadBlocks', async () => {
        const storage = new factory.Storage({});
        const block1 = createDummyBlock(factory, 0);
        const block2 = createDummyBlock(factory, 1);
        const block3 = createDummyBlock(factory, 10);

        // save them
        await storage.saveBlock(block1);
        await storage.saveBlock(block2);
        await storage.saveBlock(block3);

        // remove it
        await storage.removeBadBlocks(new Set([block1.getHash(), block3.getHash()]));

        const bi1 = await storage.getBlockInfo(block1.getHash());
        assert.isOk(bi1.isBad());
        assert.isOk(await await storage.hasBlock(block1.getHash()));

        const bi2 = await storage.getBlockInfo(block2.getHash());
        assert.isNotOk(bi2.isBad());
        assert.isOk(await await storage.hasBlock(block2.getHash()));
        await storage.getBlock(block2.getHash());

        const bi3 = await storage.getBlockInfo(block3.getHash());
        assert.isOk(bi3.isBad());
        assert.isOk(await await storage.hasBlock(block3.getHash()));
    });

    it('should set/get PendingBlockHashes', async () => {
        const storage = new factory.Storage({});

        const emptyArr = await storage.getPendingBlockHashes();
        assert.isOk(Array.isArray(emptyArr));
        assert.equal(emptyArr.length, 0);

        const newArr = [pseudoRandomBuffer().toString('hex'), pseudoRandomBuffer().toString('hex')];
        await storage.updatePendingBlocks(newArr);

        const gotArr = await storage.getPendingBlockHashes();
        assert.isOk(Array.isArray(gotArr));
        assert.equal(gotArr.length, 2);
        assert.isOk(arrayEquals(newArr, gotArr));
    });

    it('should apply patch with contract and getContract', async () => {
        const groupId = 10;
        const patch = new factory.PatchDB(groupId);
        const address = generateAddress();
        const data = {value: 10};
        const strCode = 'getData(){return this._data}';
        patch.setContract(address, data, strCode);

        const storage = new factory.Storage({});
        await storage.applyPatch(patch);

        const contract = await storage.getContract(address);
        assert.isOk(contract);
        assert.equal(contract.getGroupId(), groupId);
        assert.deepEqual(contract.getData(), data);
        assert.equal(contract.getCode(), strCode);
    });

    it('should write to db encoded data (buffers)', async () => {
        const groupId = 10;
        const patch = new factory.PatchDB(groupId);
        const storage = new factory.Storage({});

        const buffUtxoHash = pseudoRandomBuffer();
        patch.createCoins(buffUtxoHash, 1, new factory.Coins(1000, generateAddress()));
        const buffContractAddr = generateAddress();
        patch.setContract(buffContractAddr, {data: 1}, `let code=1`);
        patch.setReceipt(buffUtxoHash, new factory.TxReceipt({
            contractAddress: buffContractAddr,
            coinsUsed: 1000
        }));

        await storage.applyPatch(patch);

        assert.isOk(Buffer.isBuffer(await storage.getUtxo(buffUtxoHash, true)));
        assert.isOk(Buffer.isBuffer(await storage.getContract(buffContractAddr, true)));
        assert.isOk(Buffer.isBuffer(await storage.getTxReceipt(buffUtxoHash, true)));

        const block = new factory.Block(0);
        block.finish(1e5, pseudoRandomBuffer(33));
        const blockInfo = new factory.BlockInfo(block.header);

        await storage.saveBlock(block, blockInfo);

        assert.isOk(Buffer.isBuffer(await storage.getBlock(block.getHash(), true)));
        assert.isOk(Buffer.isBuffer(await storage.getBlockInfo(block.getHash(), true)));

        await storage.updateLastAppliedBlocks([block.getHash()]);

        assert.isOk(Buffer.isBuffer(await storage.getLastAppliedBlockHashes(true)));

        await storage.updatePendingBlocks([pseudoRandomBuffer()]);

        assert.isOk(Buffer.isBuffer(await storage.getPendingBlockHashes(true)));
    });
});
