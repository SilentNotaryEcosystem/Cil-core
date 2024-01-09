'use strict';

const assert = require('assert');
const debugLib = require('debug');
const {BI_BKP} = require('../utils');

const debugIndex = debugLib('node:dag-index');

module.exports = (MainDag, MainDagIndex, factory) => {
    const {Constants, BlockInfo} = factory;
    return class MainDagWithIndex {
        constructor(props) {
            const {storage} = props;
            assert(storage, 'MainDagWithIndex constructor requires Storage instance!');

            this._mainDag = new MainDag();
            this._mainDagIndex = new MainDagIndex();
            this._arrMainDagPages = [];
            this._storage = storage;
        }

        // MainDag interface start
        get order() {
            return this._mainDag.order;
        }

        get size() {
            return this._mainDag.size;
        }

        get tips() {
            return this._mainDag.tips;
        }

        addBlock(blockInfo) {
            this._mainDag.addBlock(blockInfo);
        }

        setBlockInfo(blockInfo) {
            this._mainDag.setBlockInfo(blockInfo);
        }

        getBlockInfo(strHash, nBackUpSource = 0) {
            const objBlockInfo = this._mainDag.getBlockInfo(strHash);
            if (objBlockInfo || !nBackUpSource) return objBlockInfo;

            return this._getBlockInfoFromStorage(strHash, nBackUpSource);
        }

        getParents(strHash) {
            return this._mainDag.getParents(strHash);
        }

        getChildren(strHash, bLoadFromStorage = false) {
            if (!bLoadFromStorage) return this._mainDag.getChildren(strHash);

            return this._getChildrenFromStorage(strHash);
        }

        getBlockHeight(strHash) {
            return this._mainDag.getBlockHeight(strHash);
        }

        removeBlock(strHash) {
            this._mainDag.removeBlock(strHash);
        }
        // MainDag interface finish

        async _getParentBlocks(blockInfo, nBackUpSource) {
            return (
                await Promise.all(
                    blockInfo.parentHashes.map(async hash => await this.getBlockInfo(hash, nBackUpSource))
                )
            ).filter(item => item !== undefined);
        }

        // MainDagIndex interface finish
        getLowestPageHeight(nPageIndex) {
            return this._mainDagIndex.getLowestPageHeight(nPageIndex);
        }

        getHighestPageIndex() {
            return this._mainDagIndex.getHighestPageIndex();
        }

        isIndexEmpty() {
            return this._mainDagIndex.isEmpty();
        }

        async addBlockIndex(blockInfo, nBackUpSource, bIsTipBlock = false) {
            const arrParentBlocks = await this._getParentBlocks(blockInfo, nBackUpSource);

            this._mainDagIndex.addBlock(blockInfo, arrParentBlocks, bIsTipBlock);
        }
        // MainDagIndex interface finish

        compactMainDag(bLeaveOnlyHigestPages = false) {
            const nDagOrderToKeep =
                (Constants.DAG_PAGES2KEEP_TOP +
                    (bLeaveOnlyHigestPages ? 0 : Constants.DAG_PAGES2KEEP_BOTTOM) +
                    Constants.DAG_PAGES2KEEP_GAP) *
                Constants.DAG_INDEX_STEP;

            const HEAP_THRESHOLD2COMPACT = Constants.HEAP_THRESHOLD2COMPACT_IN_MB * Math.pow(1024, 2);

            if (this._mainDag.order < nDagOrderToKeep && process.memoryUsage().heapUsed < HEAP_THRESHOLD2COMPACT) {
                return;
            }

            const nHighestPageIndex = this._mainDagIndex.getHighestPageIndex();
            const nTopHeightThreshold = this._mainDagIndex.getLowestPageHeight(
                nHighestPageIndex - Constants.DAG_PAGES2KEEP_TOP
            );
            const newMainDag = new MainDag();

            for (let strHash of this._mainDag.V) {
                const blockInfo = this._mainDag.getBlockInfo(strHash);
                if (blockInfo && blockInfo.getHeight() >= nTopHeightThreshold) {
                    newMainDag.addBlock(blockInfo);
                }
            }

            if (!bLeaveOnlyHigestPages) {
                const nLowestPageIndex = this._mainDagIndex.getLowestPageIndex();
                const nBottomHeightThreshold = this._mainDagIndex.getHighestPageHeight(
                    nLowestPageIndex + Constants.DAG_PAGES2KEEP_BOTTOM
                );

                for (let strHash of this._mainDag.V) {
                    const blockInfo = this._mainDag.getBlockInfo(strHash);
                    if (blockInfo && blockInfo.getHeight() <= nBottomHeightThreshold) {
                        newMainDag.addBlock(blockInfo);
                    }
                }
            }

            this._mainDag = newMainDag;
            this._arrMainDagPages = [];

            if (global.gc) global.gc();
        }

        async _restoreMainDagPages(arrPagesToRestore) {
            this.compactMainDag(true);

            const bAlreadyLoaded = arrPagesToRestore.every(hash => this._arrMainDagPages.includes(hash));
            if (bAlreadyLoaded) return;

            for (let nPageIndex of arrPagesToRestore) {
                if (this._arrMainDagPages.includes(nPageIndex)) continue;

                this._arrMainDagPages.push(nPageIndex);
                const arrInitialPageHashes = this._mainDagIndex.getInitialPageHashes(nPageIndex);
                const nLowestHeight = this._mainDagIndex.getLowestPageHeight(nPageIndex);

                if (!arrInitialPageHashes.length) continue;

                await this._restoreMainDagPageFromInitialHashes(arrInitialPageHashes, nLowestHeight);
            }
        }

        async _restoreMainDagPageFromInitialHashes(arrInitialPageHashes, nLowestHeight) {
            let arrCurrentLevel = arrInitialPageHashes;

            while (arrCurrentLevel.length) {
                const setNextLevel = new Set();
                for (let strHash of arrCurrentLevel) {
                    // we already processed this block
                    if (this._mainDag.getBlockInfo(strHash)) continue;

                    let block = await this._storage.getBlock(strHash).catch(err => debugIndex(err));
                    if (!block) throw new Error('_buildMainDag: Found missed blocks!');

                    const bi = new BlockInfo(block.header);
                    if (bi.isBad()) throw new Error(`_buildMainDag: found bad block ${strHash} in final DAG!`);

                    const nHeight = bi.getHeight();
                    if (nHeight < nLowestHeight) continue;

                    await this._mainDag.addBlock(bi);

                    if (nHeight === nLowestHeight) continue;

                    for (let parentHash of bi.parentHashes) {
                        if (!this._mainDag.getBlockInfo(parentHash)) setNextLevel.add(parentHash);
                    }
                }

                // Do we reach GENESIS?
                if (arrCurrentLevel.length === 1 && arrCurrentLevel[0] === Constants.GENESIS_BLOCK) break;

                // not yet
                arrCurrentLevel = [...setNextLevel.values()];
            }
        }

        async restoreBlocksFromLastKnown(arrHashes) {
            if (!arrHashes.length) return;

            // To reduce memory usage for inv request
            // Or throw an exception?
            const arrReducedHashes = [...new Set(arrHashes)].slice(0, Constants.MAX_LAST_KNOWN_HASHES_COUNT);

            const arrHeights = await this._getLastKnownHeights(arrReducedHashes);

            if (!arrHeights.length) return;

            const arrPages = [];
            for (let nHeight of arrHeights) {
                arrPages.push(...this._mainDagIndex.getPageSequence(nHeight, nHeight + Constants.MAX_BLOCKS_INV));
            }

            const arrPagesToRestore = Array.from(new Set(arrPages)).sort((a, b) => b - a);

            await this._restoreMainDagPages(arrPagesToRestore);
        }

        async _getLastKnownHeights(arrHashes) {
            return (
                await Promise.all(
                    arrHashes.map(async hash => {
                        const blockInfo = await this.getBlockInfo(hash, BI_BKP.BLOCK_INFO);
                        if (!blockInfo) return undefined;
                        return blockInfo.getHeight();
                    })
                )
            ).filter(item => item !== undefined);
        }

        async _getBlockInfoFromStorage(strHash, nBackUpSource = 0) {
            switch (nBackUpSource) {
                case BI_BKP.BLOCK_INFO:
                    return await this._storage.getBlockInfo(strHash).catch(err => debugIndex(err));
                case BI_BKP.BLOCK: {
                    const block = await this._storage.getBlock(strHash).catch(err => debugIndex(err));
                    if (!block) return undefined;

                    return new BlockInfo(block.header);
                }
                default:
                    return undefined;
            }
        }

        async _getChildrenFromStorage(strHash) {
            const blockInfo = await this._storage.getBlockInfo(strHash).catch(err => debugIndex(err));
            if (!blockInfo) return [];

            const nHeight = blockInfo.getHeight();
            const arrPagesToRestore = this._mainDagIndex.getPageSequence(
                nHeight,
                nHeight + Constants.DAG_INDEX_STEP * Constants.DAG_PAGES2RESTORE4CHILDREN
            );

            await this._restoreMainDagPages(arrPagesToRestore);

            return this._mainDag.getChildren(strHash);
        }
    };
};
