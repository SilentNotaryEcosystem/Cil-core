'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');
const debug = require('debug')('pendingBlocksManager:');

const factory = require('./testFactory');

const {pseudoRandomBuffer, createDummyBlock, createDummyTx, createNonMergeablePatch} = require('./testUtil');
const {arrayEquals} = require('../utils');

const createBlockWithTx = (witnessId = 0) => {
    const block = new factory.Block(witnessId);
    const tx = createDummyTx(undefined, witnessId);
    block.addTx(tx);
    block.finish(factory.Constants.MIN_TX_FEE, pseudoRandomBuffer(33));
    return block;
};

/**
 * Duplicate block, but change witnessGroupId & change tx
 */
const makeDoubleSpend = (block, newWitnessId) => {
    const newBlock = new factory.Block(newWitnessId);

    // first is coinbase
    const tx = new factory.Transaction(block.txns[1]);
    tx.witnessGroupId = newWitnessId;
    newBlock.addTx(tx);
    newBlock.finish(factory.Constants.MIN_TX_FEE, pseudoRandomBuffer(33));
    return newBlock;
};

describe('Pending block manager', async () => {
    before(async function() {
        await factory.asyncLoad();
    });

    it('should add block', async () => {
        const pbm = new factory.PendingBlocksManager();
        const block = createDummyBlock(factory);
        block.parentHashes = [
            pseudoRandomBuffer().toString('hex'),
            pseudoRandomBuffer().toString('hex'),
            pseudoRandomBuffer().toString('hex')
        ];
        pbm.addBlock(block, new factory.PatchDB());

        // 4 vertices: block hash + 3 parents
        assert.equal(pbm.getDag().order, 4);

        // 3 edges to parents
        assert.equal(pbm.getDag().size, 3);
    });

    it('should test "finalParentsForBlock"', async () => {
        const pbm = new factory.PendingBlocksManager();
        const block = createDummyBlock(factory);
        block.parentHashes = [
            pseudoRandomBuffer().toString('hex'),
            pseudoRandomBuffer().toString('hex'),
            pseudoRandomBuffer().toString('hex')
        ];
        const arrMissedPatches = pbm.finalParentsForBlock(block);
        assert.isOk(Array.isArray(arrMissedPatches));
        assert.equal(arrMissedPatches.length, 3);
    });

    it('should test "getVertexWitnessBelow"', async () => {
        const pbm = new factory.PendingBlocksManager();

        const block1 = createDummyBlock(factory, 0);
        const block2 = createDummyBlock(factory, 2);
        const block3 = createDummyBlock(factory, 0);
        const block4 = createDummyBlock(factory, 3);

        block2.parentHashes = [block1.getHash()];
        block3.parentHashes = [block1.getHash()];
        block4.parentHashes = [block2.getHash()];

        pbm.addBlock(block1, new factory.PatchDB());
        pbm.addBlock(block2, new factory.PatchDB());
        pbm.addBlock(block3, new factory.PatchDB());
        pbm.addBlock(block4, new factory.PatchDB());

        assert.equal(pbm.getVertexWitnessBelow(block1.getHash()), 1);
        assert.equal(pbm.getVertexWitnessBelow(block3.getHash()), 1);
        assert.equal(pbm.getVertexWitnessBelow(block2.getHash()), 2);
        assert.equal(pbm.getVertexWitnessBelow(block4.getHash()), 3);
    });

    it('should select all 3 parents (no conflicts)', async () => {
        const pbm = new factory.PendingBlocksManager();

        const block1 = createDummyBlock(factory, 1);
        const block2 = createDummyBlock(factory, 2);
        const block3 = createDummyBlock(factory, 3);

        pbm.addBlock(block1, new factory.PatchDB());
        pbm.addBlock(block2, new factory.PatchDB());
        pbm.addBlock(block3, new factory.PatchDB());

        const {arrParents} = await pbm.getBestParents();
        assert.isOk(arrParents.length, 3);
        assert.isOk(arrayEquals(arrParents, [block1.getHash(), block2.getHash(), block3.getHash()]));
    });

    it('should select only 1 parent (conflict)', async () => {
        const pbm = new factory.PendingBlocksManager();

        const block1 = createDummyBlock(factory, 1);
        const block2 = createDummyBlock(factory, 2);

        const patch = new factory.PatchDB();
        patch.merge = sinon.fake.throws();

        pbm.addBlock(block1, patch);
        pbm.addBlock(block2, patch);

        const {arrParents} = await pbm.getBestParents();
        assert.isOk(arrParents.length, 1);
        assert.isOk(arrayEquals(arrParents, [block1.getHash()]));
    });

    it('should select longest chain 3->2 (3 & 1 conflicts)', async () => {
        const pbm = new factory.PendingBlocksManager();

        const block1 = createDummyBlock(factory, 1);
        const block2 = createDummyBlock(factory, 2);
        const block3 = createDummyBlock(factory, 3);

        block3.parentHashes = [block2.getHash()];

        const patch = new factory.PatchDB();
        patch.merge = sinon.fake.throws();

        pbm.addBlock(block1, patch);
        pbm.addBlock(block2, patch);
        pbm.addBlock(block3, patch);

        const {arrParents} = await pbm.getBestParents();
        assert.isOk(arrParents.length, 1);
        assert.isOk(arrayEquals(arrParents, [block3.getHash()]));
    });

    it('should call merge 9 times', async () => {

        const pbm = new factory.PendingBlocksManager();

        const patch = new factory.PatchDB();
        patch.merge = sinon.fake.returns(patch);

        for (let i = 1; i < 11; i++) {
            const block = createDummyBlock(factory, i, i + 1);
            pbm.addBlock(block, patch);
        }
        await pbm.getBestParents();

        // because first patch is assigned not merged
        assert.isOk(patch.merge.callCount === 9);
    });

    it('should select 2 from 3  (has conflicts)', async () => {
        const pbm = new factory.PendingBlocksManager();

        const block1 = createDummyBlock(factory, 1);
        const block2 = createDummyBlock(factory, 2);
        const block3 = createDummyBlock(factory, 3);
        const block4 = createDummyBlock(factory, 4);

        block3.parentHashes = [block2.getHash()];

        let callCount = 0;
        const patch = new factory.PatchDB();
        patch.merge = () => {

            // really it's a second merge. first merge with self made by assignment
            if (++callCount === 1) {
                throw new Error('Conflict');
            }
        };

        pbm.addBlock(block1, patch);
        pbm.addBlock(block2, patch);
        pbm.addBlock(block3, patch);
        pbm.addBlock(block4, patch);

        const {arrParents} = await pbm.getBestParents();

        assert.isOk(arrParents.length === 2);

        // 'hash1' - conflicts
        assert.isOk(arrayEquals(arrParents, [block3.getHash(), block4.getHash()]));
    });

    describe('FINALITY', async () => {
        let pbm;
        beforeEach(async () => {
            pbm = new factory.PendingBlocksManager();
        });

        it('should fail to reach the FINALITY (no majority of 2)', async function() {
            this.timeout(15000);

            const block1 = createDummyBlock(factory, 1, 10);
            pbm.addBlock(block1, new factory.PatchDB());

            const result = pbm.checkFinality(block1.getHash(), 2);
            assert.isNotOk(result);
        });

        it('should reach the FINALITY (majority of 1)', async function() {
            this.timeout(15000);

            const block1 = createDummyBlock(factory, 1, 10);
            pbm.addBlock(block1, new factory.PatchDB());

            const {setStableBlocks, setBlocksToRollback} = pbm.checkFinality(block1.getHash(), 1);
            assert.equal(setBlocksToRollback.size, 0);
            assert.equal(setStableBlocks.size, 1);

            // DAG is empty
            assert.equal(pbm._dag.order, 0);
        });

        it('should reach the FINALITY (simple chain produced by 2 witnesses)', async () => {
            const block1 = createDummyBlock(factory, 1, 10);
            const block2 = createDummyBlock(factory, 2, 11);
            block2.parentHashes = [
                block1.getHash()
            ];

            pbm.addBlock(block1, new factory.PatchDB());
            pbm.addBlock(block2, new factory.PatchDB());

            const {setStableBlocks, setBlocksToRollback} = pbm.checkFinality(block2.getHash(), 2);
            assert.equal(setBlocksToRollback.size, 0);
            assert.equal(setStableBlocks.size, 1);

            // DAG has one vertex
            assert.isOk(arrayEquals(pbm.getTips(), [block2.getHash()]));
        });

        it('should reach the FINALITY (chain produced by 2 witnesses, one long by one)', async () => {
            const block1 = createDummyBlock(factory, 1, 10);
            const block2 = createDummyBlock(factory, 1, 11);
            const block3 = createDummyBlock(factory, 1, 12);
            const block4 = createDummyBlock(factory, 2, 11);

            block2.parentHashes = [block1.getHash()];
            block3.parentHashes = [block2.getHash()];
            block4.parentHashes = [block3.getHash()];

            pbm.addBlock(block1, new factory.PatchDB());
            pbm.addBlock(block2, new factory.PatchDB());
            pbm.addBlock(block3, new factory.PatchDB());
            pbm.addBlock(block4, new factory.PatchDB());

            const {setStableBlocks, setBlocksToRollback} = pbm.checkFinality(block4.getHash(), 2);
            assert.equal(setBlocksToRollback.size, 0);
            assert.equal(setStableBlocks.size, 3);

            // DAG has one vertex
            assert.isOk(arrayEquals(pbm.getTips(), [block4.getHash()]));
        });

        it('should reach the FINALITY (3 groups. conflicting branches)', async () => {

            const numOfWitnessGroup = 3;

            // see illustration page "rejected block consensus"
            const block1 = createDummyBlock(factory, 0);
            const block2 = createDummyBlock(factory, 1);
            const block3 = createDummyBlock(factory, 2);

            pbm.addBlock(block2, new factory.PatchDB());

            const patchThatWouldntMerge = createNonMergeablePatch(factory);

            // this will cause an exception if we try to merge it
            patchThatWouldntMerge._data = undefined;
            pbm.addBlock(block3, patchThatWouldntMerge);

            let block5;
            {
                const {arrParents} = await pbm.getBestParents();

                // block 3 (or 2) will fail to merge
                assert.equal(arrParents.length, 1);

                block5 = createDummyBlock(factory, 1);
                block5.parentHashes = arrParents;
                pbm.addBlock(block5, new factory.PatchDB());
            }

            let block6;
            {
                const {arrParents} = await pbm.getBestParents();
                assert.equal(arrParents.length, 1);

                block6 = createDummyBlock(factory, 1);
                block6.parentHashes = arrParents;
                pbm.addBlock(block6, new factory.PatchDB());
                const result = pbm.checkFinality(block6.getHash(), numOfWitnessGroup);

                // no finality
                assert.notOk(result);
            }

            // connection to group0 restored
            pbm.addBlock(block1, new factory.PatchDB());
            {
                const result = pbm.checkFinality(block1.getHash(), numOfWitnessGroup);

                // no finality
                assert.notOk(result);
            }

            const block7 = createDummyBlock(factory, 0);
            {
                block7.parentHashes = [block1.getHash(), block5.getHash()];
                pbm.addBlock(block7, new factory.PatchDB());

                // finality!
                const {setStableBlocks, setBlocksToRollback} = pbm.checkFinality(block7.getHash(), numOfWitnessGroup);

                assert.equal(setBlocksToRollback.size, 1);
                assert.isOk(setBlocksToRollback.has(block3.getHash()));

                // it's block 5 & 2 (or 3)
                assert.equal(setStableBlocks.size, 2);
            }

            const block8 = createDummyBlock(factory, 1);
            {
                const {arrParents} = await pbm.getBestParents();
                assert.equal(arrParents.length, 2);

                // chain through 7->1 (vs 6) will be more witnessed
                assert.equal(arrParents[0], block7.getHash());
                assert.equal(arrParents[1], block6.getHash());

                block8.parentHashes = arrParents;
                pbm.addBlock(block8, new factory.PatchDB());

                // finality!
                const {setStableBlocks, setBlocksToRollback} = pbm.checkFinality(block8.getHash(), numOfWitnessGroup);

                // block 3 is already deleted
                assert.equal(setBlocksToRollback.size, 0);

                // it's block 7 & 1
                assert.equal(setStableBlocks.size, 2);
            }

        });
    });
});
