'use strict';

const typeforce = require('typeforce');
const types = require('../types');

module.exports = ({Constants}) => {
    return class MainDagIndex {
        constructor() {
            this._data = new Map();
        }

        _createRecord() {
            return {
                // start page hashes with top page height
                topHashes: new Set(),
                // start page hashes with not top page height
                insideHashes: new Map(),
                // children from other pages
                // won't use it, just for a reference
                // hashes point to insideHashes & topHashes
                outsideHashes: new Map()
            };
        }

        isEmpty() {
            return !this._data.size;
        }

        addBlock(blockInfo, arrParentBlocks, bIsInitialBlock = false) {
            typeforce(types.BlockInfo, blockInfo);
            typeforce(typeforce.arrayOf(types.BlockInfo), arrParentBlocks);
            typeforce(typeforce.Boolean, bIsInitialBlock);

            const nHeight = blockInfo.getHeight();
            const nPageIndex = this.getPageIndex(nHeight);
            const nHighestPageHeight = this.getHighestPageHeight(nPageIndex);

            const objPageData = this._data.get(nPageIndex) || this._createRecord();

            if (nHeight === nHighestPageHeight) {
                objPageData.topHashes.add(blockInfo.getHash());
            } else if (bIsInitialBlock) {
                objPageData.insideHashes.set(blockInfo.getHash(), nHeight);
            }

            // if we have parent in insideHashes, remove it
            if ((nHeight === nHighestPageHeight || bIsInitialBlock) && objPageData.insideHashes.size) {
                for (const strParentHash of blockInfo.parentHashes) {
                    if (objPageData.insideHashes.has(strParentHash)) {
                        objPageData.insideHashes.delete(strParentHash);
                    }
                }
            }

            this._data.set(nPageIndex, objPageData);

            // find links to other pages with height difference more than 1
            for (const parentBlockInfo of arrParentBlocks) {
                const nParentHeight = parentBlockInfo.getHeight();
                if (nHeight - nParentHeight === 1 || nPageIndex === this.getPageIndex(nParentHeight)) {
                    continue;
                }
                this._addToOutsidePage(blockInfo, parentBlockInfo);
            }
        }

        _addToOutsidePage(blockInfo, parentBlockInfo) {
            const nParentHeight = parentBlockInfo.getHeight();
            const nPageIndex = this.getPageIndex(nParentHeight);
            const objPageData = this._data.get(nPageIndex) || this._createRecord();

            objPageData.outsideHashes.set(blockInfo.getHash(), blockInfo.getHeight());

            if (nParentHeight === this.getHighestPageHeight(nPageIndex)) {
                objPageData.topHashes.add(parentBlockInfo.getHash());
            } else {
                objPageData.insideHashes.set(parentBlockInfo.getHash(), nParentHeight);
            }

            this._data.set(nPageIndex, objPageData);
        }

        removeBlock(nHeight, strHash) {
            throw new Error('Not implemented');
        }

        getHighestPagesToRestore() {
            const nHighestPageIndex = this._getHighestPageIndex();
            const nLowestPageIndex = this._getLowestPageIndex();

            if (nHighestPageIndex === nLowestPageIndex) return [nHighestPageIndex];

            if (nHighestPageIndex - nLowestPageIndex <= Constants.DAG_PAGES2RESTORE) {
                return this._range(nLowestPageIndex, nHighestPageIndex).sort((a, b) => b - a);
            }

            const arrHighestPages = this._range(nHighestPageIndex - Constants.DAG_PAGES2RESTORE, nHighestPageIndex);

            return arrHighestPages.sort((a, b) => b - a);
        }

        getPageSequence(nLowestHeight, nHighestHeight) {
            typeforce('Number', nLowestHeight);
            typeforce('Number', nHighestHeight);

            const nLowestPageIndex = this._getLowestPageIndex();
            const nHighestPageIndex = this._getHighestPageIndex();

            const nLowestRequestedPageIndex = this.getPageIndex(nLowestHeight);
            const nHighestRequestedPageIndex = this.getPageIndex(nHighestHeight);

            const nStart = Math.max(nLowestRequestedPageIndex, nLowestPageIndex);
            const nStop = Math.min(nHighestRequestedPageIndex, nHighestPageIndex);

            return this._range(nStart, nStop).sort((a, b) => b - a);
        }

        getInitialPageHashes(nPageIndex) {
            typeforce('Number', nPageIndex);

            const objData = this._data.get(nPageIndex);
            if (!objData) return [];

            return [...objData.topHashes.values()].concat([...objData.insideHashes.keys()]);
        }

        _getLowestPageIndex() {
            return Math.min(...this._data.keys());
        }

        _getHighestPageIndex() {
            return Math.max(...this._data.keys());
        }

        getPageIndex(nBlockHeight) {
            return Math.floor(nBlockHeight / Constants.DAG_INDEX_STEP);
        }

        getLowestPageHeight(nPageIndex) {
            typeforce('Number', nPageIndex);
            return nPageIndex * Constants.DAG_INDEX_STEP;
        }

        getHighestPageHeight(nPageIndex) {
            typeforce('Number', nPageIndex);
            return (nPageIndex + 1) * Constants.DAG_INDEX_STEP - 1;
        }

        _range(nStart, nStop) {
            return Array.from({length: nStop - nStart + 1}, (_, i) => nStart + i);
        }
    };
};
