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
                // hashes point to insideHashes
                outsideHashes: new Map()
            };
        }

        get size() {
            return this._data.size;
        }

        addBlock(blockInfo, arrParentBlocks, bIsInitialBlock = false) {
            typeforce(types.BlockInfo, blockInfo);
            typeforce(typeforce.arrayOf(types.BlockInfo), arrParentBlocks);
            typeforce(typeforce.Boolean, bIsInitialBlock);

            const nHeight = blockInfo.getHeight();
            const nHighestPageHeight = this.getHighestPageHeight(nHeight);
            const nPageIndex = this._getPageIndex(nHeight);

            const objPageData = this._data.get(nPageIndex) || this._createRecord();

            const nInsideHashesSize = objPageData.insideHashes.size;

            if (nHeight === nHighestPageHeight) {
                objPageData.topHashes.add(blockInfo.getHash());
            } else if (bIsInitialBlock) {
                objPageData.insideHashes.set(blockInfo.getHash(), nHeight);
            }

            // if we have parent in insideHashes, remove it
            if ((nHeight === nHighestPageHeight || bIsInitialBlock) && nInsideHashesSize) {
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
                if (nHeight - nParentHeight === 1 || nPageIndex === this._getPageIndex(nParentHeight)) {
                    continue;
                }
                this._addToOutsidePage(blockInfo, parentBlockInfo);
            }

            // надо модифицировать алгоритм построения DAG
            // тогда мы на следующем шаге ещё будем помнить хэши и высоты предыдущего

            // this._data.get(nPageIndex).set(strHash, nHeight);
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

            const nLowestRequestedPageIndex = this._getPageIndex(nLowestHeight);
            const nHighestRequestedPageIndex = this._getPageIndex(nHighestHeight);

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

        _addToOutsidePage(blockInfo, parentBlockInfo) {
            const nParentHeight = parentBlockInfo.getHeight();
            const nPageIndex = this._getPageIndex(nParentHeight);
            const objPageData = this._data.get(nPageIndex) || this._createRecord();
            const nHighestPageHeight = this.getHighestPageHeight(nParentHeight);

            objPageData.outsideHashes.set(blockInfo.getHash(), blockInfo.getHeight());

            if (nParentHeight === nHighestPageHeight) {
                objPageData.topHashes.add(parentBlockInfo.getHash());
            } else {
                objPageData.insideHashes.set(parentBlockInfo.getHash(), nParentHeight);
            }

            this._data.set(nPageIndex, objPageData);
        }

        _getHighestPageIndex() {
            return Math.max(...this._data.keys());
        }

        _getLowestPageIndex() {
            return Math.min(...this._data.keys());
        }

        _getPageIndex(nBlockHeight) {
            return Math.floor(nBlockHeight / Constants.DAG_INDEX_STEP);
        }

        getHighestPageHeight(nBlockHeight) {
            return this._getPageIndex(nBlockHeight) * Constants.DAG_INDEX_STEP + Constants.DAG_INDEX_STEP - 1;
        }

        getLowestPageHeight(nPageIndex) {
            return nPageIndex * Constants.DAG_INDEX_STEP;
        }

        _range(nStart, nStop) {
            return Array.from({length: nStop - nStart + 1}, (_, i) => nStart + i);
        }

        printUsual() {
            const arrKeys = [...this._data.keys()].filter(
                key => !this._data.get(key).insideHashes.size && !this._data.get(key).outsideHashes.size
            );
            for (let key of arrKeys) {
                console.log('Page: ', key, this._data.get(key));
            }
        }

        printUnusual() {
            const arrKeys = [...this._data.keys()].filter(
                key => this._data.get(key).insideHashes.size || this._data.get(key).outsideHashes.size
            );
            for (let key of arrKeys) {
                console.log('Page: ', key, this._data.get(key));
            }
        }
    };
};
