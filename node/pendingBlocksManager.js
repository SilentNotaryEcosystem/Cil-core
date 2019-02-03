'use strict';

const assert = require('assert');
const {Dag} = require('dagjs');
const typeforce = require('typeforce');
const debugLib = require('debug');

const types = require('../types');
const {mergeSets} = require('../utils');

const debug = debugLib('pendingBlocksManager:');

// IMPORTANT: how many witnesses should include it in graph to make it stable
const majority = (nGroup) => parseInt(nGroup / 2) + 1;

module.exports = (factory) => {
    const {Constants, PatchDB} = factory;
    assert(Constants);
    assert(PatchDB);

    return class PendingBlocksManager {
        constructor(arrTopStable) {
            this._dag = new Dag();

            this._topStable = arrTopStable;

            // see node.rebuildPending
        }

        getDag() {
            return this._dag;
        }

        hasBlock(hash) {
            typeforce(types.Str64, hash);

            return this._dag.hasVertex(hash);
        }

        addBlock(block, patchState) {
            typeforce(typeforce.tuple(types.Block, types.Patch), arguments);

            this._dag.addVertex(block.getHash());
            for (let strHash of block.parentHashes) {
                if (this._dag.hasVertex(strHash)) this._dag.add(block.getHash(), strHash);
            }
            this._dag.saveObj(block.getHash(), {patch: patchState, blockHeader: block.header});
        }

        /**
         *
         * @param {String} vertex - block hash as vertex name
         * @returns {number} - Max number of unique witnesses in all paths from this vertex
         * @private
         */
        getVertexWitnessBelow(vertex) {
            typeforce(types.Str64, vertex);

            if (!vertex) return -1;
            const arrPaths = [...this._dag.findPathsDown(vertex)];
            return arrPaths.reduce((maxNum, path) => {
                const setWitnessGroupIds = new Set();
                path.forEach(vertex => {
                    const {blockHeader} = this._dag.readObj(vertex) || {};
                    if (!blockHeader) return;
                    setWitnessGroupIds.add(blockHeader.witnessGroupId);
                });
                return maxNum > setWitnessGroupIds.size ? maxNum : setWitnessGroupIds.size;
            }, 0);
        }

        /**
         *
         * @returns {Array} of tips (free vertexes in graph)
         */
        getTips() {
            return this._dag.tips;
        }

        /**
         * It will check "compatibility" of tips (ability to merge patches)
         *
         * @returns {arrParents}
         * @private
         */
        async getBestParents() {
            let arrTips = this.getTips();

            if (!arrTips.length) arrTips = this._topStable;
            if (!arrTips.length) arrTips = [Constants.GENESIS_BLOCK];

            // TODO: consider using process.nextTick() (this could be time consuming)
            // @see https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick/
            const arrParents = [];

            const sortedDownTipIndexes = this._sortTips(arrTips);

            // TODO: review it. this implementation (merging most witnessed vertex with other) could be non optimal
            const patchMerged = this.mergePatches(sortedDownTipIndexes.map(i => arrTips[i]), arrParents, true);

            // TODO: review it
            if (!arrParents.length) logger.debug('No pending parents found, using stable tips!');
            return {
                arrParents: arrParents.length ? arrParents : arrTips,
                patchMerged
            };
        }

        /**
         * In a case of conflict of tips we should prefer those path, that consumed more network resources.
         * So we start from path, that:
         * - had seen most of witness
         * - if they are equal - we'll leave longest one
         *
         * @param {Array} arrTips
         * @returns {Array} sorted array of tips indexes
         * @private
         */
        _sortTips(arrTips) {

            // get max witnessed path for all tips
            const arrWitnessNums = arrTips.map(vertex => this.getVertexWitnessBelow(vertex));

            // sort it descending
            return arrTips
                .map((e, i) => i)
                .sort((i1, i2) => {
                    const diff = arrWitnessNums[i2] - arrWitnessNums[i1];

                    // equal WitnessNum
                    if (!diff) {
                        return this._dag.findPathsDown(arrWitnessNums[i2]).getLongestPathLength() -
                               this._dag.findPathsDown(arrWitnessNums[i1]).getLongestPathLength();
                    } else {
                        return diff;
                    }
                });
        }

        /**
         * Throws error if unable to merge
         *
         * @param {Array} arrHashes - @see block.parentHashes
         * @param {Array} arrSuccessfullyMergedBlocksHashes - we'll fill it with hashes of successfully merged blocks
         * @param {Boolean} bMergeAsMuchAsPossible - whether to fail on first failed merge or try as much as possible
         * @returns {PatchDB} merged patches for pending parent blocks. If there is no patch for parent
         *                      - this means it's final and applyed to storage
         */
        mergePatches(arrHashes, arrSuccessfullyMergedBlocksHashes, bMergeAsMuchAsPossible = false) {
            let patchMerged = new PatchDB();
            for (let vertex of arrHashes) {
                const {patch} = this._dag.readObj(vertex) || {};

                // this patch (block) already finial applied to storage, and removed from DAG
                if (!patch) continue;
                try {
                    patchMerged = patch.merge(patchMerged);
                    if (Array.isArray(arrSuccessfullyMergedBlocksHashes)) {
                        arrSuccessfullyMergedBlocksHashes.push(vertex);
                    }
                } catch (e) {
                    if (!bMergeAsMuchAsPossible) throw e;
                }
            }

            return patchMerged;
        }

        /**
         * Undefined means that no new stable vertices found
         *
         * @param {String} newVertex - blockHash of processed block
         * @param {Number} nGroupCount - how many groups definition existed now
         * @return {undefined | {patchToApply: PatchDB, setStableBlocks: Set, setBlocksToRollback: Set, arrTopStable: Array}}
         */
        checkFinality(newVertex, nGroupCount) {
            typeforce(typeforce.tuple(types.Str64, 'Number'), arguments);

            // find all path from this vertex
            const arrTopStable = this._findTopStable(newVertex, majority(nGroupCount));

            // no stable yet - stop here
            if (!arrTopStable.length) return;

            debug(`Found ${arrTopStable.length} top stables`);

            // merge all "new stable blocks" patches
            // WE CHOOSE ONLY TOP PATCH BECAUSE IT'S MOST CONSISTENT
            const patchToApply = this.mergePatches(arrTopStable);

            // form set of all vertices that become stable and just remove them
            const setAlsoStableVertices = this._findAlsoStable(arrTopStable);
            this._removeBlocks(setAlsoStableVertices);

            debug(`Removed total ${setAlsoStableVertices.size} stable`);

            // remove bad chains (their tips will conflict with patchToApply)
            const setBlocksToRollback = this._removeConflictingBranches(patchToApply);

            if (setBlocksToRollback.size) debug(`Removed ${setBlocksToRollback.size} blocks from conflicting branches`);
            debug(`Remaining DAG order ${this._dag.order}.`);

            // purge pending patches to save memory
            for (let vertex of this._dag.V) {
                const {patch} = this._dag.readObj(vertex);
                patch.purge(patchToApply);
            }

            // apply patchToApply to storage, undo all setBlocksToRollback

            this._topStable = arrTopStable;

            return {
                patchToApply,
                setStableBlocks: setAlsoStableVertices,
                setBlocksToRollback,
                arrTopStable
            };
        }

        /**
         *
         * @param {String} newVertex
         * @param {Number} nMajority  nMajority how many witness required to mark as final (how many of them "saw" block)
         * @returns {Array} of "top stable vertices" (hashes)
         * @private
         */
        _findTopStable(newVertex, nMajority) {
            typeforce(typeforce.tuple(types.Str64, 'Number'), arguments);

            const arrTopStable = [];

            const arrPaths = this._dag.findPathsDown(newVertex);
            for (let path of arrPaths) {
                const vertex = this._findTopStableForPath(path, nMajority);
                if (vertex) arrTopStable.push(vertex);
            }
            return arrTopStable;
        }

        /**
         *
         * @param {Path} path in DAG
         * @param {Number} nMajority how many witness required to mark as final (how many of them "saw" block)
         * @returns {String} "top stable vertex" (block hash)
         * @private
         */
        _findTopStableForPath(path, nMajority) {
            const setWitnessGroupIds = new Set();

            for (let vertex of path) {
                const {blockHeader} = this._dag.readObj(vertex) || {};
                if (!blockHeader) continue;
                setWitnessGroupIds.add(blockHeader.witnessGroupId);

                if (setWitnessGroupIds.size >= nMajority) return vertex;
            }

            // no stable - return undefined!
        }

        /**
         * Form set of vertices that become stable (this SET will include "top stable")
         *
         * @param {Array} arrTopStable - of vertices (block hashes)
         * @returns {Set}
         * @private
         */
        _findAlsoStable(arrTopStable) {
            typeforce('Array', arrTopStable);

            let setAlsoStableVertices = new Set();
            for (let vertexTopStable of arrTopStable) {
                const pathsAlsoStable = this._dag.findPathsDown(vertexTopStable);
                setAlsoStableVertices = mergeSets(setAlsoStableVertices, new Set(pathsAlsoStable.vertices()));
            }

            return setAlsoStableVertices;
        }

        /**
         *
         * @param {PatchDB} patchToApply - merged patch that we'll apply to storage
         * @returns {Set} of hashes block to unroll to mempool
         * @private
         */
        _removeConflictingBranches(patchToApply) {
            typeforce(types.Patch, patchToApply);

            // TODO: improve it by searching WHICH vertex contain conflict, and remove only vertices above.
            //      Now we rollback whole branch

            let setBlocksToRollback = new Set();
            for (let tip of this.getTips()) {
                const {patch} = this._dag.readObj(tip);
                try {
                    patch.merge(patchToApply);
                } catch (e) {

                    // merge failed! this means that tip is on top of incompatible branch
                    setBlocksToRollback = mergeSets(
                        new Set(this._dag.findPathsDown(tip).vertices()),
                        setBlocksToRollback
                    );
                }

            }
            this._removeBlocks(setBlocksToRollback);

            return setBlocksToRollback;
        }

        /**
         *
         * @param {Set} setBlocks - hashes of blocks (vertices) that we'll remove from DAG
         * @private
         */
        _removeBlocks(setBlocks) {
            for (let vertex of setBlocks.values()) {
                this._dag.removeVertex(vertex);
            }
        }

        /**
         * Return all block hashes that are pending
         *
         * @return {Array}
         */
        getAllHashes() {
            return this._dag.V;
        }
    };
};
