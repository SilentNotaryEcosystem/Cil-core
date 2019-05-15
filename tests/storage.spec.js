'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
chai.use(require('chai-as-promised'));
const {assert} = chai;

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
        conciliumId: 0,
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

    it('should save/load block. No txIndex enabled', async () => {
        const block = createDummyBlock(factory);
        const storage = new factory.Storage();
        await storage.saveBlock(block);

        const restoredBlock = await storage.getBlock(block.getHash());

        assert.equal(block.getHash(), restoredBlock.getHash());
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

    it('should get UTXOs from DB as patch', async () => {
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
        const conciliumId = 10;
        const patch = new factory.PatchDB(conciliumId);
        const address = generateAddress();
        const data = {value: 10};
        const strCode = 'getData(){return this._data}';
        {
            const contract = new factory.Contract({
                contractData: data,
                contractCode: strCode,
                conciliumId
            });
            contract.storeAddress(address);
            patch.setContract(contract);
        }

        const storage = new factory.Storage();
        await storage.applyPatch(patch);

        const contract = await storage.getContract(address);
        assert.isOk(contract);
        assert.equal(contract.getConciliumId(), conciliumId);
        assert.deepEqual(contract.getData(), data);
        assert.equal(contract.getCode(), strCode);
    });

    it('should write to db encoded data (buffers)', async () => {
        const conciliumId = 10;
        const patch = new factory.PatchDB(conciliumId);
        const storage = new factory.Storage();

        const buffUtxoHash = pseudoRandomBuffer();
        patch.createCoins(buffUtxoHash, 1, new factory.Coins(1000, generateAddress()));
        const buffContractAddr = generateAddress();
        {
            const contract = new factory.Contract({
                contractData: {data: 1},
                contractCode: `let code=1`,
                conciliumId
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
                conciliumId: 0
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

    it('should read concilium definitions', async () => {
        const contractAddress = generateAddress();
        factory.Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS = contractAddress;

        const def1 = factory.ConciliumDefinition.create(
            0,
            [Buffer.from('public1'), Buffer.from('public2')]
        );
        const def2 = factory.ConciliumDefinition.create(
            1,
            [Buffer.from('public2'), Buffer.from('public3')]
        );

        const patch = new factory.PatchDB();
        {
            const contract = new factory.Contract({
                contractData: {
                    _arrConciliums: [
                        def1.toObject(),
                        def2.toObject()
                    ]
                },
                contractCode: '',
                conciliumId: 0
            });
            contract.storeAddress(contractAddress);
            patch.setContract(contract);
        }

        const storage = new factory.Storage();
        storage.applyPatch(patch);

        {
            const arrDefs = await storage.getConciliumsByKey(Buffer.from('public1'));
            assert.isOk(Array.isArray(arrDefs));
            assert.equal(arrDefs.length, 1);
        }

        {
            const arrDefs = await storage.getConciliumsByKey(Buffer.from('public2'));
            assert.isOk(Array.isArray(arrDefs));
            assert.equal(arrDefs.length, 2);
        }
    });

    it('should NOT find UTXO', async () => {
        const storage = new factory.Storage();
        assert.isRejected(storage.getUtxo(pseudoRandomBuffer()));
    });

    it('should get UTXO', async () => {
        const storage = new factory.Storage();

        const hash = pseudoRandomBuffer();
        const coins = new factory.Coins(1e5, generateAddress());
        const utxo = new factory.UTXO({txHash: hash});
        utxo.addCoins(0, coins);

        const patch = new factory.PatchDB();
        patch.setUtxo(utxo);
        await storage.applyPatch(patch);

        const utxoFromStorage = await storage.getUtxo(hash);

        assert.isOk(utxoFromStorage);
        utxoFromStorage.equals(utxo);
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

        it('should throw. Hash not found', async () => {
            const storage = new factory.Storage({buildTxIndex: true});
            storage._txIndexStorage.get = sinon.fake.throws(new Error('Hash not found'));

            const result = await storage.findBlockByTxHash(pseudoRandomBuffer().toString('hex'));
            assert.isNotOk(result);
        });

        it('should throw. Block not found', async () => {
            const storage = new factory.Storage({buildTxIndex: true});
            storage._txIndexStorage.get = sinon.fake.resolves(pseudoRandomBuffer());
            storage.getBlock = sinon.fake.throws(new Error('Block not found'));

            const result = await storage.findBlockByTxHash(pseudoRandomBuffer().toString('hex'));
            assert.isNotOk(result);
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

    describe('Wallet support', async () => {
        let storage;

        beforeEach(async () => {
            storage = new factory.Storage({walletSupport: true});
        });

        it('should throw (no wallet support)', async () => {
            const storage = new factory.Storage();

            assert.isRejected(storage._ensureWalletInitialized());
            assert.isRejected(storage._walletWriteAddressUtxo());
            assert.isRejected(storage.walletListUnspent());
        });

        it('should load empty wallet', async () => {
            await storage._ensureWalletInitialized();

            assert.deepEqual(storage._arrStrWalletAddresses, []);
            assert.equal(storage._nWalletAutoincrement, 0);
        });

        it('should load wallet addresses', async () => {
            const addr1 = generateAddress();
            const addr2 = generateAddress();
            const autoInc = 10;

            let callCount = 0;
            storage._walletStorage.get = async () => {

                // first call - request for addresses, second - autoincrement
                return ++callCount === 1 ? Buffer.concat([addr1, addr2]) : Buffer.from([0, 0, 0, autoInc]);
            };

            await storage._ensureWalletInitialized();

            assert.isOk(Array.isArray(storage._arrStrWalletAddresses));
            assert.equal(storage._arrStrWalletAddresses.length, 2);
            assert.equal(addr1.toString('hex'), storage._arrStrWalletAddresses[0]);
            assert.equal(addr2.toString('hex'), storage._arrStrWalletAddresses[1]);

            assert.equal(storage._nWalletAutoincrement, autoInc);
        });

        it('should write/read utxo', async () => {
            const addr = generateAddress().toString('hex');
            const hash1 = pseudoRandomBuffer();
            const hash2 = pseudoRandomBuffer();

            await storage._walletWriteAddressUtxo(addr, hash1.toString('hex'));
            await storage._walletWriteAddressUtxo(addr, hash2.toString('hex'));

            // this UTXO doesn't belongs to address
            await storage._walletWriteAddressUtxo(
                generateAddress().toString('hex'),
                pseudoRandomBuffer().toString('hex')
            );

            // read it back
            const arrHashes = await storage._walletReadAddressRecords(addr);

            // totally we write 3 hashes
            assert.equal(storage._nWalletAutoincrement, 3);

            // but this address belongs only 2 utxos
            assert.equal(arrHashes.length, 2);
            assert.isOk(arrHashes[0].value.equals(hash1));
            assert.isOk(arrHashes[1].value.equals(hash2));
        });

        it('should CleanupMissed', async () => {
            const arrMissedKeys = [pseudoRandomBuffer(), pseudoRandomBuffer()];
            storage._walletStorage.batch = sinon.fake();

            await storage._walletCleanupMissed(arrMissedKeys);

            assert.isOk(storage._walletStorage.batch.calledOnce);
            const [arrOps] = storage._walletStorage.batch.args[0];

            assert.deepEqual(arrOps[0], {type: 'del', key: arrMissedKeys[0]});
            assert.deepEqual(arrOps[1], {type: 'del', key: arrMissedKeys[1]});
        });

        it('should walletListUnspent (no missed)', async () => {
            const addr = generateAddress().toString('hex');
            const hash1 = pseudoRandomBuffer();
            const hash2 = pseudoRandomBuffer();
            const fakeUtxo = 'fakeUtxo';
            storage.getUtxo = sinon.fake.returns(fakeUtxo);
            storage._arrStrWalletAddresses = [addr];
            storage._nWalletAutoincrement = 0;

            await storage._walletWriteAddressUtxo(addr, hash1.toString('hex'));
            await storage._walletWriteAddressUtxo(addr, hash2.toString('hex'));

            const arrResults = await storage.walletListUnspent(addr);

            assert.equal(arrResults.length, 2);
            assert.isOk(arrResults.every(utxo => utxo === fakeUtxo));
        });

        it('should walletListUnspent (purge missed)', async () => {
            const addr = generateAddress().toString('hex');
            const hash1 = pseudoRandomBuffer();
            const hash2 = pseudoRandomBuffer();
            const fakeUtxo = 'fakeUtxo';
            storage.getUtxo = async (hash) => {
                if (hash.equals(hash1)) return fakeUtxo;
                throw 'not found';
            };
            storage._arrStrWalletAddresses = [addr];
            storage._nWalletAutoincrement = 0;
            storage._walletCleanupMissed = sinon.fake();

            await storage._walletWriteAddressUtxo(addr, hash1.toString('hex'));
            await storage._walletWriteAddressUtxo(addr, hash2.toString('hex'));

            const arrResults = await storage.walletListUnspent(addr);

            assert.equal(arrResults.length, 1);
            assert.isOk(arrResults.every(utxo => utxo === fakeUtxo));

            assert.isOk(storage._walletCleanupMissed.calledOnce);
            assert.equal(storage._walletCleanupMissed.args[0][0].length, 1);
        });

        it('should throw (address already in wallet)', async () => {
            const addr = generateAddress().toString('hex');
            storage._arrStrWalletAddresses = [addr];

            assert.isRejected(storage.walletWatchAddress(addr));
        });

        it('should add new watched address ', async () => {
            storage._walletStorage.put = sinon.fake();

            // previously stored address
            storage._arrStrWalletAddresses = [generateAddress().toString('hex')];
            const strAddr = generateAddress().toString('hex');

            await storage.walletWatchAddress(strAddr);

            assert.isOk(storage._walletStorage.put.calledOnce);
            const [, buffSerializedAddresses] = storage._walletStorage.put.args[0];
            assert.isOk(Buffer.isBuffer(buffSerializedAddresses));
            const arrOfStrAddr = new factory.ArrayOfAddresses(buffSerializedAddresses).getArray();
            assert.equal(arrOfStrAddr.length, 2);

            // new address added
            assert.equal(arrOfStrAddr[1], strAddr);
        });

        it('should reIndex wallet', async () => {
            const buffAddr1 = generateAddress();
            const buffAddr2 = generateAddress();
            const buffAddr3 = generateAddress();
            const coins1 = new factory.Coins(1e5, buffAddr1);
            const coins2 = new factory.Coins(1e5, buffAddr2);

            // this utxo contains only coins of addr1
            const hash1 = pseudoRandomBuffer();
            const utxo1 = new factory.UTXO({txHash: hash1});
            utxo1.addCoins(0, coins1);
            utxo1.addCoins(1, coins1);
            utxo1.addCoins(2, coins1);

            // this utxo contains only coins of addr2
            const hash2 = pseudoRandomBuffer();
            const utxo2 = new factory.UTXO({txHash: hash2});
            utxo2.addCoins(0, coins2);
            utxo2.addCoins(2, coins2);

            // this utxo contains coins for both addresses
            const hash3 = pseudoRandomBuffer();
            const utxo3 = new factory.UTXO({txHash: hash3});
            utxo3.addCoins(0, coins1);
            utxo3.addCoins(10, coins2);

            const patch = new factory.PatchDB();
            patch.setUtxo(utxo1);
            patch.setUtxo(utxo2);
            patch.setUtxo(utxo3);
            await storage.applyPatch(patch);

            await storage.walletWatchAddress(buffAddr1);
            await storage.walletWatchAddress(buffAddr2);
            await storage.walletWatchAddress(buffAddr3);

            // before reindex
            {
                const arrUtxo1 = await storage.walletListUnspent(buffAddr1.toString('hex'));
                assert.equal(arrUtxo1.length, 0);
                const arrUtxo2 = await storage.walletListUnspent(buffAddr2.toString('hex'));
                assert.equal(arrUtxo2.length, 0);
                const arrUtxo3 = await storage.walletListUnspent(buffAddr3.toString('hex'));
                assert.equal(arrUtxo3.length, 0);
            }

            await storage.walletReIndex();

            // after reindex
            {
                const arrUtxo1 = await storage.walletListUnspent(buffAddr1.toString('hex'));
                assert.equal(arrUtxo1.length, 2);
                const arrUtxo2 = await storage.walletListUnspent(buffAddr2.toString('hex'));
                assert.equal(arrUtxo2.length, 2);
                const arrUtxo3 = await storage.walletListUnspent(buffAddr3.toString('hex'));
                assert.equal(arrUtxo3.length, 0);
            }
        });
    });
});
