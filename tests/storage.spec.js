'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();

const debugChannel = 'storage:*';
process.env['DEBUG'] = `${debugChannel},` + process.env['DEBUG'];

const debugLib = require('debug');
const debug = debugLib(debugChannel);

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
        const wrapper = () => new factory.Storage();
        assert.doesNotThrow(wrapper);
    });

    it('should save block. No txIndex enabled', async () => {
        const block = createDummyBlock(factory);
        const storage = new factory.Storage();
        await storage.saveBlock(block);
    });

    it('should find block in storage', async () => {
        const block = createDummyBlock(factory);
        const storage = new factory.Storage();
        await storage.saveBlock(block);

        assert.isOk(await storage.hasBlock(block.hash()));
    });

    it('should THROWS find block in storage (param check failed)', async () => {
        const storage = new factory.Storage();

        try {
            await storage.hasBlock('133');
        } catch (e) {
            return;
        }
        throw ('Unexpected success');
    });

    it('should NOT find block in storage', async () => {
        const storage = new factory.Storage();
        assert.isNotOk(await storage.hasBlock(pseudoRandomBuffer(32)));
    });

    it('should NOT find block in storage', async () => {
        const storage = new factory.Storage();
        assert.isNotOk(await storage.hasBlock(pseudoRandomBuffer(32).toString('hex')));
    });

    it('should get saved block', async () => {
        const block = createDummyBlock(factory);
        const storage = new factory.Storage();
        await storage.saveBlock(block);

        const gotBlock = await storage.getBlock(block.hash());

        assert.isOk(gotBlock.txns);
        const rTx = new factory.Transaction(gotBlock.txns[0]);
    });

    it('should apply "addCoins" patch to empty storage (like genesis)', async () => {
        const storage = new factory.Storage();

        const patch = new factory.PatchDB(0);
        const txHash = pseudoRandomBuffer().toString('hex');
        const coins = new factory.Coins(100, generateAddress());
        patch.createCoins(txHash, 12, coins);
        patch.createCoins(txHash, 0, coins);
        patch.createCoins(txHash, 80, coins);

        const txHash2 = pseudoRandomBuffer().toString('hex');
        const coins2 = new factory.Coins(200, generateAddress());
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
        const storage = new factory.Storage();

        // create coins that we plan to spend
        const patch = new factory.PatchDB(0);
        const txHash = pseudoRandomBuffer().toString('hex');
        const coins = new factory.Coins(100, generateAddress());
        patch.createCoins(txHash, 12, coins);
        patch.createCoins(txHash, 0, coins);
        patch.createCoins(txHash, 80, coins);

        const txHash2 = pseudoRandomBuffer().toString('hex');
        const coins2 = new factory.Coins(200, generateAddress());
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
        const storage = new factory.Storage();

        const patch = new factory.PatchDB(0);
        const txHash = pseudoRandomBuffer().toString('hex');
        const txHash2 = pseudoRandomBuffer().toString('hex');
        const txHash3 = pseudoRandomBuffer().toString('hex');
        const coins = new factory.Coins(100, generateAddress());

        patch.createCoins(txHash, 12, coins);
        patch.createCoins(txHash2, 0, coins);
        patch.createCoins(txHash3, 80, coins);

        await storage.applyPatch(patch);

        const patchWithUtxos = await storage.getUtxosPatch([txHash, txHash2, txHash3]);

        assert.isOk(patchWithUtxos);
        assert.isOk(patchWithUtxos.getUtxo(txHash));
        assert.isOk(patchWithUtxos.getUtxo(txHash2));
        assert.isOk(patchWithUtxos.getUtxo(txHash3));
    });

    // if we find UTXO with same hash
    // @see bip30 https://github.com/bitcoin/bitcoin/commit/a206b0ea12eb4606b93323268fc81a4f1f952531)
    it('should find TX COLLISION', async () => {
        const storage = new factory.Storage();

        const patch = new factory.PatchDB(0);

        const txHash = pseudoRandomBuffer().toString('hex');
        const coins = new factory.Coins(100, generateAddress());
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
        const storage = new factory.Storage();

        const patch = new factory.PatchDB(0);

        const txHash = pseudoRandomBuffer().toString('hex');
        const coins = new factory.Coins(100, generateAddress());
        patch.createCoins(txHash, 12, coins);

        await storage.applyPatch(patch);
        await storage.checkTxCollision([pseudoRandomBuffer().toString('hex')]);
    });

    it('should SET/GET BlockInfo', async () => {
        const storage = new factory.Storage();
        const blockInfo = createBlockInfo();
        await storage.saveBlockInfo(blockInfo);
        const result = await storage.getBlockInfo(blockInfo.getHash());

        // just check
        assert.isOk(blockInfo.getHeader().merkleRoot.equals(result.getHeader().merkleRoot));
    });

    it('should store LAST_APPLIED_BLOCKS', async () => {
        const storage = new factory.Storage();
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

    it('should removeBadBlocks', async () => {
        const storage = new factory.Storage();
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
        const storage = new factory.Storage();

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
        {
            const contract = new factory.Contract({
                contractData: data,
                contractCode: strCode,
                groupId
            });
            contract.storeAddress(address);
            patch.setContract(contract);
        }

        const storage = new factory.Storage();
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
        const storage = new factory.Storage();

        const buffUtxoHash = pseudoRandomBuffer();
        patch.createCoins(buffUtxoHash, 1, new factory.Coins(1000, generateAddress()));
        const buffContractAddr = generateAddress();
        {
            const contract = new factory.Contract({
                contractData: {data: 1},
                contractCode: `let code=1`,
                groupId
            });
            contract.storeAddress(buffContractAddr);
            patch.setContract(contract);
        }
        patch.setReceipt(buffUtxoHash.toString('hex'), new factory.TxReceipt({
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

    it('should store/read contract', async () => {
        const contractData = {a: 1};
        const contractCode = 'let a=1;';
        const contractAddress = generateAddress();

        const patch = new factory.PatchDB();
        {
            const contract = new factory.Contract({
                contractData,
                contractCode,
                groupId: 0
            });
            contract.storeAddress(contractAddress);
            patch.setContract(contract);
        }
        const storage = new factory.Storage();
        await storage.applyPatch(patch);

        const contract = await storage.getContract(contractAddress);
        assert.isOk(contract);
        assert.deepEqual(contract.getData(), contractData);
        assert.equal(contract.getCode(), contractCode);
    });

    it('should read group definitions', async () => {
        const contractAddress = generateAddress();
        factory.Constants.GROUP_DEFINITION_CONTRACT_ADDRESS = contractAddress;

        const def1 = factory.WitnessGroupDefinition.create(
            0,
            [Buffer.from('public1'), Buffer.from('public2')]
        );
        const def2 = factory.WitnessGroupDefinition.create(
            1,
            [Buffer.from('public2'), Buffer.from('public3')]
        );

        const patch = new factory.PatchDB();
        {
            const contract = new factory.Contract({
                contractData: {
                    _arrGroupDefinitions: [
                        def1.toObject(),
                        def2.toObject()
                    ]
                },
                contractCode: '',
                groupId: 0
            });
            contract.storeAddress(contractAddress);
            patch.setContract(contract);
        }

        const storage = new factory.Storage();
        storage.applyPatch(patch);

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

    it('should NOT find UTXO', async () => {
        const storage = new factory.Storage();
        try {
            await storage.getUtxo(pseudoRandomBuffer());
        } catch (e) {
            return;
        }
        throw 'Unexpected success';
    });

    it('should set/get RECEIPT', async () => {
        const storage = new factory.Storage();

        const buffContractAddr = generateAddress();
        const buffUtxoHash = pseudoRandomBuffer();
        const coinsUsed = 1e5;
        const arrInternalTxns = [pseudoRandomBuffer().toString('hex'), pseudoRandomBuffer().toString('hex')];

        const patch = new factory.PatchDB();
        const rcpt = new factory.TxReceipt({
            contractAddress: buffContractAddr,
            coinsUsed
        });
        arrInternalTxns.forEach(tx => rcpt.addInternalTx(tx));
        patch.setReceipt(buffUtxoHash.toString('hex'), rcpt);

        // set
        await storage.applyPatch(patch);

        // get
        const receipt = await storage.getTxReceipt(buffUtxoHash.toString('hex'));

        assert.isOk(receipt);
        assert.equal(coinsUsed, receipt.getCoinsUsed());
        assert.isOk(buffContractAddr.equals(Buffer.from(receipt.getContractAddress(), 'hex')));
        assert.isOk(
            receipt
                .getInternalTxns()
                .every(buffTxHash => arrInternalTxns.includes(buffTxHash.toString('hex')))
        );
    });

    describe('TX index', () => {
        it('should throw. No txIndex enabled', (done) => {
            const storage = new factory.Storage();

            storage.findBlockByTxHash(pseudoRandomBuffer().toString('hex'))
                .then(_ => done(new Error('Unexpected success')))
                .catch(_ => done());
        });

        it('should throw. Hash not found', (done) => {
            const storage = new factory.Storage({buildTxIndex: true});
            storage._txIndexStorage.get = sinon.fake.throws(new Error('Hash not found'));

            storage.findBlockByTxHash(pseudoRandomBuffer().toString('hex'))
                .then(_ => done(new Error('Unexpected success')))
                .catch(_ => done());
        });

        it('should throw. Block not found', (done) => {
            const storage = new factory.Storage({buildTxIndex: true});
            storage._txIndexStorage.get = sinon.fake.resolves(pseudoRandomBuffer());
            storage.getBlock = sinon.fake.throws(new Error('Block not found'));

            storage.findBlockByTxHash(pseudoRandomBuffer().toString('hex'))
                .then(_ => done(new Error('Unexpected success')))
                .catch(_ => done());
        });

        it('should success', async () => {
            const storage = new factory.Storage({buildTxIndex: true});
            storage._txIndexStorage.get = sinon.fake.resolves(pseudoRandomBuffer());
            storage.getBlock = sinon.fake();

            await storage.findBlockByTxHash(pseudoRandomBuffer().toString('hex'));

            assert.isOk(storage.getBlock.calledOnce);
        });

        it('should just save block and index', async () => {
            const storage = new factory.Storage({buildTxIndex: true});
            const storeIndexFake = storage._txIndexStorage.batch = sinon.fake();
            const block = createDummyBlock(factory);

            await storage.saveBlock(block);

            assert.isOk(storeIndexFake.calledOnce);
            const [arrRecords] = storeIndexFake.args[0];
            const arrTxHashes = block.getTxHashes();
            assert.isOk(arrRecords.every(rec => arrTxHashes.includes(rec.key.toString('hex')) &&
                                                rec.value.toString('hex') === block.getHash()));
        });
    });
});
