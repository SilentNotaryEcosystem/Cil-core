'use strict';

const assert = require('assert');
const {Dag} = require('dagjs');
const typeforce = require('typeforce');
const debugLib = require('debug');

const types = require('../types');
const {mergeSets} = require('../utils');

const debug = debugLib('pendingBlocksManager:');

// IMPORTANT: how many witnesses should include it in graph to make it stable
const majority = (nConcilium) => parseInt(nConcilium / 2) + 1;

module.exports = (factory, factoryOptions) => {
    const {Constants, PatchDB} = factory;
    assert(Constants);
    assert(PatchDB);

    return class PendingBlocksManager {
        constructor(options) {
            options = {
                ...factoryOptions,
                ...options
            };

            const {mutex, arrTopStable} = options;

            this._dag = new Dag();
            this._dag.testForCyclic = false;

            this._topStable = arrTopStable;

            this._mutex = mutex;

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

            return this._mutex.runExclusive('pbm', async () => {
                this._dag.addVertex(block.getHash());
                for (let strHash of block.parentHashes) {
                    if (this._dag.hasVertex(strHash)) this._dag.add(block.getHash(), strHash);
                }
                this._dag.saveObj(
                    block.getHash(),
                    {patch: patchState, blockHeader: block.header, bIsEmpty: block.isEmpty()}
                );
            });
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
                const setConciliumIds = new Set();
                path.forEach(vertex => {
                    const {blockHeader} = this._dag.readObj(vertex) || {};
                    if (!blockHeader) return;
                    setConciliumIds.add(blockHeader.conciliumId);
                });
                return maxNum > setConciliumIds.size ? maxNum : setConciliumIds.size;
            }, 0);
        }

        /**
         *
         * @returns {Array} of hashes (string) of tips (free vertexes in graph)
         */
        getTips() {
            return this._dag.tips;
        }

        /**
         * @param {String} hash
         * @returns {Array}  of blocks that are children of a block with hash
         */
        getChildren(hash) {
            typeforce(types.Str64, hash);
            return this._dag.edgesTo(hash).tips;
        }

        /**
         * @param {String} hash
         * @returns {patch, blockHeader, bIsEmpty}
         */
        getBlock(hash) {
            typeforce(types.Str64, hash);
            return this._dag.readObj(hash);
        }

        /**
         * It will check "compatibility" of tips (ability to merge patches)
         *
         * @param {Number} nConciliumId
         * @returns {{arrParents, patchMerged}}
         * @private
         */
        async getBestParents(nConciliumId) {
            let arrTips = this.getTips();
            const lastResort = this._topStable && this._topStable.length ? this._topStable : [Constants.GENESIS_BLOCK];

            if (!arrTips || !arrTips.length) arrTips = lastResort;

            // TODO: consider using process.nextTick() (this could be time consuming)
            // @see https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick/
            const arrParents = [];

            const sortedDownTipIndexes = this._sortTips(arrTips, nConciliumId);

            // TODO: review it. this implementation (merging most witnessed vertex with other) could be non optimal
            let patchMerged;
            try {
                patchMerged = await this.mergePatches(
                    sortedDownTipIndexes.map(i => arrTips[i]),
                    arrParents
                );
            } catch (e) {
            }

            // TODO: review it
            if (!arrParents.length) logger.debug('No pending parents found, using stable tips!');

            return {
                arrParents: arrParents.length ? arrParents : lastResort,
                patchMerged
            };
        }

        /**
         *
         * @param {Array} arrHashes
         * @param {Number} nConciliumId
         * @return {String | undefined}
         * @private
         */
        _findByConciliumId(arrHashes, nConciliumId) {
            if (nConciliumId === undefined) return undefined;

            const [hash] = arrHashes.filter(vertex => {
                const objResult = this._dag.readObj(vertex);
                if (!objResult) return false;
                return objResult.blockHeader.conciliumId === nConciliumId;
            });
            return hash;
        }

        /**
         * In a case of conflict of tips we should prefer those path, that consumed more network resources.
         * So we start from path, that:
         * - had seen most of witness
         * - if they are equal - we'll leave longest one
         *
         * @param {Array} arrTips
         * @param {Number} nConciliumId
         * @returns {Array} sorted array of tips indexes
         * @private
         */
        _sortTips(arrTips, nConciliumId) {

            // find previous block of selected concilium (if any)
            // first of all, we should build non-conflicting path for selected concilium,
            // so we'll include own tip, if any
            const prevBlockHash = this._findByConciliumId(arrTips, nConciliumId);
            let prevBlockIndex;
            if (prevBlockHash) prevBlockIndex = arrTips.findIndex(hash => hash === prevBlockHash);

            // get max witnessed path for all tips
            const arrWitnessNums = arrTips.map(vertex => this.getVertexWitnessBelow(vertex));

            // sort it descending
            return arrTips
                .map((e, i) => i)
                .sort((i1, i2) => {

                    // this will bring prevBlockHash to the head of array
                    if (i1 === prevBlockIndex) return -1;
                    if (i2 === prevBlockIndex) return 1;

                    const diff = arrWitnessNums[i2] - arrWitnessNums[i1];

                    // equal WitnessNum
                    if (!diff) {
                        return this._dag.findPathsDown(arrTips[i2]).getLongestPathLength() -
                               this._dag.findPathsDown(arrTips[i1]).getLongestPathLength();
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
         * @returns {PatchDB} merged patches for pending parent blocks. If there is no patch for parent
         *                      - this means it's final and applyed to storage
         */
        mergePatches(arrHashes, arrSuccessfullyMergedBlocksHashes) {

            // no arrSuccessfullyMergedBlocksHashes, then we'r trying to validate block
            // has - we'r trying to getBestParents, merge as much as possible
            const bThrowOnFail = !arrSuccessfullyMergedBlocksHashes;
            return this._mutex.runExclusive('pbm', async () => {
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
                        if (bThrowOnFail) throw e;
                    }
                }

                return patchMerged;
            });
        }

        /**
         * Undefined means that no new stable vertices found
         *
         * @param {String} strHashNewVertex - blockHash of processed block
         * @param {Number} nConciliumCount - how many conciliums definition existed now
         * @return {undefined | {patchToApply: PatchDB, setStableBlocks: Set, setBlocksToRollback: Set, arrTopStable: Array}}
         */
        async checkFinality(strHashNewVertex, nConciliumCount) {
            typeforce(typeforce.tuple(types.Str64, 'Number'), arguments);

            // find all path from this vertex
            const arrTopStable = this._findTopStable(strHashNewVertex, majority(nConciliumCount));

            // no stable yet - stop here
            if (!arrTopStable.length) return;

            debug(`Found ${arrTopStable.length} top stables`);

            // form set of all vertices that become stable and just remove them
            const setAlsoStableVertices = this._findAlsoStable(arrTopStable);

            // merge all "new stable blocks" patches
            // WE CHOOSE ONLY TOP PATCH BECAUSE IT'S MOST CONSISTENT
            const patchToApply = await this.mergePatches(arrTopStable);

            const lock = await this._mutex.acquire('pbm');
            let setBlocksToRollback;

            try {
                this._removeBlocks(setAlsoStableVertices);
                debug(`Removed total ${setAlsoStableVertices.size} stable`);

                // remove bad chains (their tips will conflict with patchToApply)
                setBlocksToRollback = this._removeConflictingBranches(strHashNewVertex, patchToApply);

                if (setBlocksToRollback.size) {
                    debug(`Removed ${setBlocksToRollback.size} blocks from conflicting branches`);
                }
                debug(`Remaining DAG order ${this._dag.order}.`);

                // purge pending patches to save memory
                for (let vertex of this._dag.V) {
                    const {patch} = this._dag.readObj(vertex);
                    patch.purge(patchToApply);
                }
            } finally {
                this._mutex.release(lock);
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
            const setConciliumIds = new Set();

            for (let vertex of path) {
                const {blockHeader} = this._dag.readObj(vertex) || {};
                if (!blockHeader) continue;
                setConciliumIds.add(blockHeader.conciliumId);

                if (setConciliumIds.size >= nMajority) return vertex;
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
         * @param {String} strHashToExclude - new vertex that already known as non-conflicting
         * @param {PatchDB} patchToApply - merged patch that we'll apply to storage
         * @returns {Set} of hashes block to unroll to mempool
         * @private
         */
        _removeConflictingBranches(strHashToExclude, patchToApply) {
            typeforce(types.Patch, patchToApply);

            // TODO: improve it by searching WHICH vertex contain conflict, and remove only vertices above.
            //      Now we rollback whole branch

            let setBlocksToRollback = new Set();
            for (let tip of this.getTips()) {
                if (tip === strHashToExclude) continue;
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

        /**
         *
         * @param {String} strContractAddr
         * @param {Number} nConciliumId
         * @returns {Contract | undefined}
         */
        getContract(strContractAddr, nConciliumId) {
            typeforce(typeforce.tuple(types.StrAddress, typeforce.Number), arguments);

            const arrTips = this.getTips();

            // find longest path containing patches with ${nConciliumId}
            let strHashBestTip = undefined;
            let nMaxLevel = 0;
            for (let hash of arrTips) {
                const {patch} = this._dag.readObj(hash);
                if (patch.getLevel(nConciliumId) > nMaxLevel) {
                    strHashBestTip = hash;
                    nMaxLevel = patch.getLevel(nConciliumId);
                }
            }
            if (!strHashBestTip) return undefined;

            for (let path of this._dag.findPathsDown(strHashBestTip)) {
                for (let vertex of path) {
                    const {patch} = this._dag.readObj(vertex);

                    // we find most recent one
                    if (patch.getLevel(nConciliumId) === nMaxLevel && patch.getConciliumId() === nConciliumId) {
                        return patch.getContract(strContractAddr);
                    }
                }
            }

            return undefined;
        }

        /**
         * is there a reason to create a block of "nConciliumId" upon bestParents
         *
         * the reason is if we have at least one tip that has no blocks of "nConciliumId" in every path
         * from this "tip" to stable blocks
         * and there is at least one non-empty blocks
         *
         * @param {Block} block - that we look a reason to process
         * @returns {Boolean}
         */
        isReasonToWitness(block) {

            // we are interested only in pending parents!
            const arrParents = block.parentHashes.filter(strHash => this._dag.hasVertex(strHash));

            return arrParents.find(hash => {

                // no reason to create block upon own previous
                const {blockHeader, bIsEmpty} = this._dag.readObj(hash);
                if (blockHeader.conciliumId === block.conciliumId && bIsEmpty) return false;

                const arrPaths = this._dag.findPathsDown(hash);
                for (let path of arrPaths) {
                    for (let vertex of path) {
                        const {blockHeader, bIsEmpty} = this._dag.readObj(vertex);
                        if (!bIsEmpty && blockHeader.conciliumId !== block.conciliumId) return true;
                    }
                }
                return false;
            });
        }

        forEach(fnCallback) {
            this._dag.V.forEach(fnCallback);
        }

        removeBlock(strHash) {
            typeforce(types.Str64, strHash);

            return this._mutex.runExclusive('pbm', async () => {
                this._dag.removeVertex(strHash);
            });
        }
    };
};
