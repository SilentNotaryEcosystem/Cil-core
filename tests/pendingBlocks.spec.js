'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');
const debug = require('debug')('pendingBlocksManager:');

const factory = require('./testFactory');

const {pseudoRandomBuffer, createDummyBlock, createNonMergeablePatch, generateAddress} = require('./testUtil');
const {arrayEquals} = require('../utils');

const createNonEmptyBlock = (nConciliumId) => {
    const block = createDummyBlock(factory, nConciliumId);
    block.isEmpty = () => false;
    return block;
};

const createRhombus = async (pbm, bNonEmpty = false) => {
    const createBlockFunction = bNonEmpty ? createNonEmptyBlock : createDummyBlock.bind(createDummyBlock, factory);

    const block1 = createBlockFunction(1);
    const block2 = createBlockFunction(2);
    const block3 = createBlockFunction(3);
    const block4 = createBlockFunction(4);

    const patch = new factory.PatchDB();

    block2.parentHashes = [block1.getHash()];
    block3.parentHashes = [block1.getHash()];
    block4.parentHashes = [block2.getHash(), block3.getHash()];

    await pbm.addBlock(block1, patch);
    await pbm.addBlock(block2, patch);
    await pbm.addBlock(block3, patch);
    await pbm.addBlock(block4, patch);

    return block4;
};

/**
 * Duplicate block, but change conciliumId & change tx
 */
const makeDoubleSpend = (block, newConciliumId) => {
    const newBlock = new factory.Block(newConciliumId);

    // first is coinbase
    const tx = new factory.Transaction(block.txns[1]);
    tx.conciliumId = newConciliumId;
    newBlock.addTx(tx);
    newBlock.finish(factory.Constants.fees.TX_FEE, generateAddress());
    return newBlock;
};

const createSample = async (pbm, isContractFound = false) => {
    const block1 = createDummyBlock(factory, 0);
    const patch1 = new factory.PatchDB(0);

    const block2 = createDummyBlock(factory, 0);
    block2.parentHashes = [block1.getHash()];
    const patch2 = patch1.merge(new factory.PatchDB());
    patch2.setConciliumId(0);

    // let's add another concilium
    const block3 = createDummyBlock(factory, 1);
    block3.parentHashes = [block2.getHash()];
    const patch3 = patch2.merge(new factory.PatchDB());
    patch3.setConciliumId(1);

    // target concilium again
    const block4 = createDummyBlock(factory, 0);
    block4.parentHashes = [block3.getHash()];
    const patch4 = patch3.merge(new factory.PatchDB());
    patch4.setConciliumId(0);

    // this patch will win for concilium 0
    patch4.getContract = sinon.fake.returns(isContractFound);

    // let's add another concilium again
    const block5 = createDummyBlock(factory, 1);
    block5.parentHashes = [block4.getHash()];
    const patch5 = patch4.merge(new factory.PatchDB());
    patch5.setConciliumId(1);

    // let's add third concilium with parent of 2d block
    const block6 = createDummyBlock(factory, 2);
    block6.parentHashes = [block2.getHash()];
    const patch6 = patch4.merge(new factory.PatchDB());
    patch6.setConciliumId(2);

    await pbm.addBlock(block1, patch1);
    await pbm.addBlock(block2, patch2);
    await pbm.addBlock(block3, patch3);
    await pbm.addBlock(block4, patch4);
    await pbm.addBlock(block5, patch5);
    await pbm.addBlock(block6, patch6);

    return [block1, block2, block3, block4, block5, block6].map(b => b.getHash());
};

describe('Pending block manager', async () => {
    let pbm;

    before(async function() {
        await factory.asyncLoad();
    });

    beforeEach(async () => {
        pbm = new factory.PendingBlocksManager({});
    });

    it('should add block', async () => {

        const block = createDummyBlock(factory);
        block.parentHashes = [
            pseudoRandomBuffer().toString('hex'),
            pseudoRandomBuffer().toString('hex'),
            pseudoRandomBuffer().toString('hex')
        ];
        await pbm.addBlock(block, new factory.PatchDB(0));

        assert.equal(pbm.getDag().order, 1);
    });

    it('should test "getVertexWitnessBelow"', async () => {


        const block1 = createDummyBlock(factory, 0);
        const block2 = createDummyBlock(factory, 2);
        const block3 = createDummyBlock(factory, 0);
        const block4 = createDummyBlock(factory, 3);

        block2.parentHashes = [block1.getHash()];
        block3.parentHashes = [block1.getHash()];
        block4.parentHashes = [block2.getHash()];

        await pbm.addBlock(block1, new factory.PatchDB(0));
        await pbm.addBlock(block2, new factory.PatchDB(0));
        await pbm.addBlock(block3, new factory.PatchDB(0));
        await pbm.addBlock(block4, new factory.PatchDB(0));

        assert.equal(pbm.getVertexWitnessBelow(block1.getHash()), 1);
        assert.equal(pbm.getVertexWitnessBelow(block3.getHash()), 1);
        assert.equal(pbm.getVertexWitnessBelow(block2.getHash()), 2);
        assert.equal(pbm.getVertexWitnessBelow(block4.getHash()), 3);
    });

    it('should select all 3 parents (no conflicts)', async () => {
        const block1 = createDummyBlock(factory, 1);
        const block2 = createDummyBlock(factory, 2);
        const block3 = createDummyBlock(factory, 3);

        await pbm.addBlock(block1, new factory.PatchDB(0));
        await pbm.addBlock(block2, new factory.PatchDB(1));
        await pbm.addBlock(block3, new factory.PatchDB(2));

        const {arrParents} = await pbm.getBestParents();
        assert.isOk(arrParents.length, 3);
        assert.isOk(arrayEquals(arrParents, [block1.getHash(), block2.getHash(), block3.getHash()]));
    });

    it('should select only 1 parent (conflict)', async () => {


        const block1 = createDummyBlock(factory, 1);
        const block2 = createDummyBlock(factory, 2);

        const patch = new factory.PatchDB(0);
        patch.merge = sinon.fake.throws();

        await pbm.addBlock(block1, new factory.PatchDB(0));
        await pbm.addBlock(block2, patch);

        const {arrParents} = await pbm.getBestParents();
        assert.isOk(arrParents.length, 1);
        assert.isOk(arrayEquals(arrParents, [block1.getHash()]));
    });

    it('should select longest chain 3->2 (3 & 1 conflicts)', async () => {


        const block1 = createDummyBlock(factory, 1);
        const block2 = createDummyBlock(factory, 2);
        const block3 = createDummyBlock(factory, 3);

        block3.parentHashes = [block2.getHash()];

        const patch = new factory.PatchDB(0);
        patch.merge = sinon.fake.throws();

        await pbm.addBlock(block1, patch);
        await pbm.addBlock(block2, patch);
        await pbm.addBlock(block3, new factory.PatchDB(0));

        const {arrParents} = await pbm.getBestParents();
        assert.isOk(arrParents.length, 1);
        assert.isOk(arrayEquals(arrParents, [block3.getHash()]));
    });

    it('should call merge 10 times', async () => {



        const patch = new factory.PatchDB(0);
        patch.merge = sinon.fake.returns(patch);

        for (let i = 1; i < 11; i++) {
            const block = createDummyBlock(factory, i, i + 1);
            await pbm.addBlock(block, patch);
        }
        await pbm.getBestParents();
        assert.isOk(patch.merge.callCount === 10);
    });

    it('should select 2 from 3  (has conflicts)', async () => {


        const block1 = createDummyBlock(factory, 1);
        const block2 = createDummyBlock(factory, 2);
        const block3 = createDummyBlock(factory, 3);
        const block4 = createDummyBlock(factory, 4);

        block3.parentHashes = [block2.getHash()];

        let callCount = 0;
        const patch = new factory.PatchDB(0);
        patch.merge = () => {
            if (++callCount === 2) {
                throw new Error('Conflict');
            }
        };

        await pbm.addBlock(block1, patch);
        await pbm.addBlock(block2, patch);
        await pbm.addBlock(block3, patch);
        await pbm.addBlock(block4, patch);

        const {arrParents} = await pbm.getBestParents();

        assert.isOk(arrParents.length === 2);

        // 'hash1' - conflicts
        assert.isOk(arrayEquals(arrParents, [block3.getHash(), block4.getHash()]));
    });

    it('should getBestParents with ', async () => {

    });

    describe('getBestParents', async () => {
        let pbm;
        beforeEach(async () => {
            pbm = new factory.PendingBlocksManager();
        });

        it('should pass for undefined conciliumId', async () => {
            factory.Constants.GENESIS_BLOCK = pseudoRandomBuffer().toString('hex');
            await pbm.getBestParents();
        });

        it('should pass for absent block of conciliumId', async () => {
            const block = createDummyBlock(factory, 0);
            await pbm.addBlock(block, new factory.PatchDB());

            const {arrParents} = await pbm.getBestParents(0);

            assert.strictEqual(arrParents.length, 1);
            assert.strictEqual(arrParents[0], block.getHash());
        });

        it('should pass for block of conciliumId (middle)', async () => {
            const block = createDummyBlock(factory, 0);

            await pbm.addBlock(createDummyBlock(factory, 1), new factory.PatchDB());
            await pbm.addBlock(block, new factory.PatchDB());
            await pbm.addBlock(createDummyBlock(factory, 2), new factory.PatchDB());

            const {arrParents} = await pbm.getBestParents(0);

            assert.strictEqual(arrParents.length, 3);
            assert.strictEqual(arrParents[0], block.getHash());
        });
        it('should pass for block of conciliumId (start)', async () => {
            const block = createDummyBlock(factory, 0);

            await pbm.addBlock(block, new factory.PatchDB());
            await pbm.addBlock(createDummyBlock(factory, 1), new factory.PatchDB());
            await pbm.addBlock(createDummyBlock(factory, 2), new factory.PatchDB());

            const {arrParents} = await pbm.getBestParents(0);

            assert.strictEqual(arrParents.length, 3);
            assert.strictEqual(arrParents[0], block.getHash());
        });
        it('should pass for block of conciliumId (tail)', async () => {
            const block = createDummyBlock(factory, 0);

            await pbm.addBlock(createDummyBlock(factory, 1), new factory.PatchDB());
            await pbm.addBlock(createDummyBlock(factory, 2), new factory.PatchDB());
            await pbm.addBlock(block, new factory.PatchDB());

            const {arrParents} = await pbm.getBestParents(0);

            assert.strictEqual(arrParents.length, 3);
            assert.strictEqual(arrParents[0], block.getHash());
        });

        it('should fail to merge own patch so will use stable tips', async () => {
            pbm._topStable = ['fake'];
            const patchNonMergable = new factory.PatchDB();
            patchNonMergable.merge = sinon.fake.throws();

            await pbm.addBlock(createDummyBlock(factory, 1), patchNonMergable);
            await pbm.addBlock(createDummyBlock(factory, 0), new factory.PatchDB());

            const {arrParents} = await pbm.getBestParents(1);

            assert.deepEqual(arrParents, ['fake']);
        });
    });

    describe('isReasonToWitness', async () => {
        let pbm;
        beforeEach(async () => {
            pbm = new factory.PendingBlocksManager({});
        });

        it('should be NO reason for empty PBM', async () => {
            factory.Constants.GENESIS_BLOCK = pseudoRandomBuffer().toString('hex');
            const block = createDummyBlock(factory, 0);

            assert.isNotOk(pbm.isReasonToWitness(block));
        });

        it('should be a reason for single tip of other concilium', async () => {
            const block = createNonEmptyBlock(1);
            await pbm.addBlock(block, new factory.PatchDB());
            const blockChild = createNonEmptyBlock(0);
            blockChild.parentHashes = [block.getHash()];

            assert.isOk(pbm.isReasonToWitness(blockChild));
        });

        it('should be NO reason for single non-empty tip of same concilium', async () => {
            const block = createNonEmptyBlock(1);
            await pbm.addBlock(block, new factory.PatchDB());
            const blockChild = createNonEmptyBlock(1);
            blockChild.parentHashes = [block.getHash()];

            assert.isNotOk(pbm.isReasonToWitness(blockChild));
        });

        it('should be NO reason for 2 empty tips', async () => {
            const block1 = createDummyBlock(factory, 1);
            const block2 = createDummyBlock(factory, 2);
            await pbm.addBlock(block1, new factory.PatchDB());
            await pbm.addBlock(block2, new factory.PatchDB());

            {
                const blockChild = createNonEmptyBlock(1);
                blockChild.parentHashes = [block1.getHash(), block2.getHash()];
                assert.isNotOk(pbm.isReasonToWitness(blockChild));
            }
            {
                const blockChild = createNonEmptyBlock(2);
                blockChild.parentHashes = [block1.getHash(), block2.getHash()];
                assert.isNotOk(pbm.isReasonToWitness(blockChild));
            }
        });

        it('should be reason for 2 non-empty tips', async () => {
            const block1 = createNonEmptyBlock(1);
            const block2 = createNonEmptyBlock(2);
            await pbm.addBlock(block1, new factory.PatchDB());
            await pbm.addBlock(block2, new factory.PatchDB());

            {
                const blockChild = createNonEmptyBlock(1);
                blockChild.parentHashes = [block1.getHash(), block2.getHash()];
                assert.isOk(pbm.isReasonToWitness(blockChild));
            }
            {
                const blockChild = createNonEmptyBlock(2);
                blockChild.parentHashes = [block1.getHash(), block2.getHash()];
                assert.isOk(pbm.isReasonToWitness(blockChild));
            }
        });

        it('should be NO reason for rhombus (existed inside rhombus)', async () => {
            const blockTip = await createRhombus(pbm);
            assert.isNotOk(pbm.isReasonToWitness(blockTip));
        });

        it('should be NO reason for rhombus (not existed inside rhombus, but empty blocks)', async () => {
            const blockTip = await createRhombus(pbm);
            const block = createNonEmptyBlock(0);
            block.parentHashes = [blockTip.getHash()];

            assert.isNotOk(pbm.isReasonToWitness(block));
        });

        it('should be a reason for rhombus (new concilium and non empty blocks)', async () => {
            const blockTip = await createRhombus(pbm, true);
            const block = createNonEmptyBlock(0);
            block.parentHashes = [blockTip.getHash()];

            assert.isOk(pbm.isReasonToWitness(block));
        });

        it('should be a reason for rhombus (existed inside rhombus of empty blocks, but has single non empty tip)',
            async () => {
                const blockTip1 = await createRhombus(pbm);
                const blockTip2 = createNonEmptyBlock(0);
                await pbm.addBlock(blockTip2, new factory.PatchDB());

                const block = createNonEmptyBlock(2);
                block.parentHashes = [blockTip1.getHash(), blockTip2.getHash()];

                assert.isOk(pbm.isReasonToWitness(block));
            }
        );

        it('should be a reason for rhombus (existed inside rhombus of non-empty blocks, but has single yet empty tip)',
            async () => {
                const blockTip1 = await createRhombus(pbm, true);
                const blockTip2 = createDummyBlock(factory, 0);
                await pbm.addBlock(blockTip2, new factory.PatchDB());

                const block = createNonEmptyBlock(2);
                block.parentHashes = [blockTip1.getHash(), blockTip2.getHash()];

                assert.isOk(pbm.isReasonToWitness(block));
            }
        );
    });

    describe('FINALITY', async () => {
        let pbm;
        beforeEach(async () => {
            pbm = new factory.PendingBlocksManager({});
        });

        it('should fail to reach the FINALITY (no majority of 2)', async function() {
            this.timeout(15000);

            const block1 = createDummyBlock(factory, 1, 10);
            await pbm.addBlock(block1, new factory.PatchDB(0));

            const result = await pbm.checkFinality(block1.getHash(), 2);
            assert.isNotOk(result);
        });

        it('should reach the FINALITY (majority of 1)', async function() {
            this.timeout(15000);

            const block1 = createDummyBlock(factory, 1);
            await pbm.addBlock(block1, new factory.PatchDB(0));

            const {setStableBlocks, setBlocksToRollback} = await pbm.checkFinality(block1.getHash(), 1);
            assert.equal(setBlocksToRollback.size, 0);
            assert.equal(setStableBlocks.size, 1);

            // DAG is empty
            assert.equal(pbm._dag.order, 0);
        });

        it('should reach the FINALITY (simple chain produced by 2 witnesses)', async () => {
            const block1 = createDummyBlock(factory, 1);
            const block2 = createDummyBlock(factory, 2);
            block2.parentHashes = [
                block1.getHash()
            ];

            await pbm.addBlock(block1, new factory.PatchDB(0));
            await pbm.addBlock(block2, new factory.PatchDB(0));

            const {setStableBlocks, setBlocksToRollback} = await pbm.checkFinality(block2.getHash(), 2);
            assert.equal(setBlocksToRollback.size, 0);
            assert.equal(setStableBlocks.size, 1);

            // DAG has one vertex
            assert.isOk(arrayEquals(pbm.getTips(), [block2.getHash()]));
        });

        it('should reach the FINALITY (chain produced by 2 witnesses, one long by one)', async () => {
            const block1 = createDummyBlock(factory, 1);
            const block2 = createDummyBlock(factory, 1);
            const block3 = createDummyBlock(factory, 1);
            const block4 = createDummyBlock(factory, 2);

            block2.parentHashes = [block1.getHash()];
            block3.parentHashes = [block2.getHash()];
            block4.parentHashes = [block3.getHash()];

            await pbm.addBlock(block1, new factory.PatchDB(0));
            await pbm.addBlock(block2, new factory.PatchDB(0));
            await pbm.addBlock(block3, new factory.PatchDB(0));
            await pbm.addBlock(block4, new factory.PatchDB(0));

            const {setStableBlocks, setBlocksToRollback} = await pbm.checkFinality(block4.getHash(), 2);
            assert.equal(setBlocksToRollback.size, 0);
            assert.equal(setStableBlocks.size, 3);

            // DAG has one vertex
            assert.isOk(arrayEquals(pbm.getTips(), [block4.getHash()]));
        });

        it('should reach the FINALITY (3 conciliums. conflicting branches)', async () => {

            const numOfConcilium = 3;

            // see illustration page "rejected block consensus"
            const block1 = createDummyBlock(factory, 0);
            const block2 = createDummyBlock(factory, 1);
            const block3 = createDummyBlock(factory, 2);

            await pbm.addBlock(block2, new factory.PatchDB(0));

            const patchThatWouldntMerge = createNonMergeablePatch(factory);

            // this will cause an exception if we try to merge it
            patchThatWouldntMerge._data = undefined;
            await pbm.addBlock(block3, patchThatWouldntMerge);

            let block5;
            {
                const {arrParents} = await pbm.getBestParents();

                // block 3 (or 2) will fail to merge
                assert.equal(arrParents.length, 1);

                block5 = createDummyBlock(factory, 1);
                block5.parentHashes = arrParents;
                await pbm.addBlock(block5, new factory.PatchDB(0));
            }

            let block6;
            {
                const {arrParents} = await pbm.getBestParents();
                assert.equal(arrParents.length, 1);

                block6 = createDummyBlock(factory, 1);
                block6.parentHashes = arrParents;
                await pbm.addBlock(block6, new factory.PatchDB(0));
                const result = await pbm.checkFinality(block6.getHash(), numOfConcilium);

                // no finality
                assert.notOk(result);
            }

            // connection to concilium0 restored
            await pbm.addBlock(block1, new factory.PatchDB(0));
            {
                const result = await pbm.checkFinality(block1.getHash(), numOfConcilium);

                // no finality
                assert.notOk(result);
            }

            const block7 = createDummyBlock(factory, 0);
            {
                block7.parentHashes = [block1.getHash(), block5.getHash()];
                await pbm.addBlock(block7, new factory.PatchDB(0));

                // finality!
                const {setStableBlocks, setBlocksToRollback} = await pbm.checkFinality(block7.getHash(),
                    numOfConcilium
                );

                assert.equal(setBlocksToRollback.size, 1);
                assert.isOk(setBlocksToRollback.has(block3.getHash()));

                // it's block 5 & 2 (or 3)
                assert.equal(setStableBlocks.size, 2);
            }

            // from now test not connected to page "rejected block consensus"
            const block8 = createDummyBlock(factory, 1);
            {
                const {arrParents} = await pbm.getBestParents();
                assert.equal(arrParents.length, 2);

                // chain through 7->1 and through 6 have same witness numbers (1) but first chain is longer
                assert.equal(arrParents[0], block7.getHash());
                assert.equal(arrParents[1], block6.getHash());

                block8.parentHashes = arrParents;
                await pbm.addBlock(block8, new factory.PatchDB(0));

                // finality!
                const {setStableBlocks, setBlocksToRollback} = await pbm.checkFinality(block8.getHash(),
                    numOfConcilium
                );

                // block 3 is already deleted
                assert.equal(setBlocksToRollback.size, 0);

                // it's block 7 & 1
                assert.equal(setStableBlocks.size, 2);
            }

        });
    });

    describe('getContract', () => {
        let pbm;
        beforeEach(async () => {
            pbm = new factory.PendingBlocksManager({});
        });
        it('should return undefined for EMPTY', async () => {
            assert.isNotOk(pbm.getContract(generateAddress().toString('hex'), 0));
        });

        it('should find tip candidate (single)', async () => {
            const block1 = createDummyBlock(factory, 0);
            await pbm.addBlock(block1, new factory.PatchDB(0));
            pbm._dag.findPathsDown = sinon.fake.returns([]);

            assert.isNotOk(pbm.getContract(generateAddress().toString('hex'), 0));

            assert.isOk(pbm._dag.findPathsDown.calledOnce);
            const [strHash] = pbm._dag.findPathsDown.args[0];
            assert.equal(strHash, block1.getHash());
        });

        it('should find tip candidate (two)', async () => {
            const block1 = createDummyBlock(factory, 0);
            const block2 = createDummyBlock(factory, 2);
            await pbm.addBlock(block1, new factory.PatchDB(0));
            await pbm.addBlock(block2, new factory.PatchDB(2));
            pbm._dag.findPathsDown = sinon.fake.returns([]);

            assert.isNotOk(pbm.getContract(generateAddress().toString('hex'), 0));

            assert.isOk(pbm._dag.findPathsDown.calledOnce);
            const [strHash] = pbm._dag.findPathsDown.args[0];
            assert.equal(strHash, block1.getHash());
        });

        it('should pick longest path in chain for concilium 0', async () => {
            const arrBlockHashes = await createSample(pbm);
            pbm._dag.findPathsDown = sinon.fake.returns([]);

            assert.isNotOk(pbm.getContract(generateAddress().toString('hex'), 0));

            assert.isOk(pbm._dag.findPathsDown.calledOnce);
            const [strHash] = pbm._dag.findPathsDown.args[0];

            // block5 is winner TIP
            assert.equal(strHash, arrBlockHashes[4]);
        });

        it('should pick longest path in chain for concilium 1', async () => {
            const arrBlockHashes = await createSample(pbm);
            pbm._dag.findPathsDown = sinon.fake.returns([]);

            assert.isNotOk(pbm.getContract(generateAddress().toString('hex'), 1));

            assert.isOk(pbm._dag.findPathsDown.calledOnce);
            const [strHash] = pbm._dag.findPathsDown.args[0];

            // block5 is winner TIP
            assert.equal(strHash, arrBlockHashes[4]);
        });

        it('should pick longest path in chain for concilium 2', async () => {
            const arrBlockHashes = await createSample(pbm);
            pbm._dag.findPathsDown = sinon.fake.returns([]);

            assert.isNotOk(pbm.getContract(generateAddress().toString('hex'), 2));

            assert.isOk(pbm._dag.findPathsDown.calledOnce);
            const [strHash] = pbm._dag.findPathsDown.args[0];

            // block6 is winner TIP
            assert.equal(strHash, arrBlockHashes[5]);
        });

        it('should return undefined. Patch found. No contract found', async () => {
            const arrHashes = await createSample(pbm);
            assert.isNotOk(pbm.getContract(generateAddress().toString('hex'), 0));

            // block4 is winner (don't confuse with winner tip, which is block5) as latest for concilium 0
            const {patch} = pbm._dag.readObj(arrHashes[3]);
            assert.isOk(patch.getContract.calledOnce);

        });

        it('should return true. Patch found. Contract found', async () => {
            await createSample(pbm, true);
            assert.isOk(pbm.getContract(generateAddress().toString('hex'), 0));
        });
    });
});
