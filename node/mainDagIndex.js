'use strict';

const typeforce = require('typeforce');
const types = require('../types');

module.exports = ({Constants}) => {
    return class MainDagIndex {
        constructor() {
            this._data = new Map();
        }

        get size() {
            return this._data.size;
        }

        couldBeCompacted(nDagOrder) {
            // console.log('order', nDagOrder)
            // console.log('compare', Constants.DAG_INDEX_STEP * (Constants.DAG_PAGES2KEEP + Constants.DAG_DELTA_PAGES2KEEP))

            return nDagOrder > Constants.DAG_INDEX_STEP * (Constants.DAG_PAGES2KEEP + Constants.DAG_DELTA_PAGES2KEEP);
        }

        // в идеале нам бы сюда передавать
        // хэш, его высоту, список родителей (blockInfo) +
        // список хэшей и высот всех родителей (выбрать из них только родительские хэши данного блока)
        addBlock(blockInfo, arrParentBlocks, bIsInitialBlock = false) {
            typeforce(types.BlockInfo, blockInfo);
            typeforce(typeforce.arrayOf(types.BlockInfo), arrParentBlocks);
            typeforce(typeforce.Boolean, bIsInitialBlock);

            const nHeight = blockInfo.getHeight();
            const strHash = blockInfo.getHash();
            const nHigestPageHeight = this.getHigestPageHeight(nHeight);
            const nPageIndex = this._getPageIndex(nHeight);

            const objPageData = this._data.get(nPageIndex) || this._createRecord();

            const nInsideHashesSize = objPageData.insideHashes.size;

            if (nHeight === nHigestPageHeight) {
                objPageData.topHashes.add(strHash);
            } else if (bIsInitialBlock) {
                objPageData.insideHashes.set(strHash, nHeight);
            }

            // if we have parent in insideHashes, remove it
            if ((nHeight === nHigestPageHeight || bIsInitialBlock) && nInsideHashesSize) {
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
                const nHeightDelta = nHeight - nParentHeight;
                if (nHeightDelta === 1 || nPageIndex === this._getPageIndex(nParentHeight)) {
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

        printUnusual() {
            const arrKeys = [...this._data.keys()].filter(
                key => this._data.get(key).insideHashes.size || this._data.get(key).outsideHashes.size
            );
            for (let key of arrKeys) {
                console.log('Page: ', key, this._data.get(key));
            }
        }

        getHigestPagesToRestore() {
            const nHigestPageIndex = this._getHigestPageIndex();
            const nLowestPageIndex = this._getLowestPageIndex();

            if (nHigestPageIndex === nLowestPageIndex) return [nHigestPageIndex];

            if (nHigestPageIndex - nLowestPageIndex <= Constants.DAG_PAGES2RESTORE) {
                return this._range(nLowestPageIndex, nHigestPageIndex).sort((a, b) => b - a);
            }

            const arrHigestPages = this._range(nHigestPageIndex - Constants.DAG_PAGES2RESTORE, nHigestPageIndex);

            return arrHigestPages.sort((a, b) => b - a);
        }

        getPagesForSequence(nLowestHeight, nHighestHeight) {
            throw new Error('getPagesForSequence');

            // typeforce('Number', nLowestHeight);
            // typeforce('Number', nHighestHeight);

            // const nLowestPageIndex = this._getLowestPageIndex();
            // const nHigestPageIndex = this._getHigestPageIndex();

            // const nLowestRequestedPageIndex = this._getPageIndex(nLowestHeight);
            // const nHighestRequestedPageIndex = this._getPageIndex(nHighestHeight);

            // const nStart = nLowestRequestedPageIndex < nLowestPageIndex ? nLowestPageIndex : nLowestRequestedPageIndex;
            // const nStop = nHighestRequestedPageIndex > nHigestPageIndex ? nHigestPageIndex : nHighestRequestedPageIndex;

            // return this._range(nStart, nStop).sort((a, b) => b - a);
        }

        getInitialPageHashes(nPageIndex) {
            const objData = this._data.get(nPageIndex);
            if (!objData) return [];

            return [...objData.topHashes.values()].concat([...objData.insideHashes.keys()]);
        }

        _addToOutsidePage(blockInfo, parentBlockInfo) {
            typeforce(types.BlockInfo, blockInfo);
            typeforce(types.BlockInfo, parentBlockInfo);

            const nHeight = blockInfo.getHeight();
            const strHash = blockInfo.getHash();
            const nParentHeight = parentBlockInfo.getHeight();
            const strParentHash = parentBlockInfo.getHash();

            const nPageIndex = this._getPageIndex(nParentHeight);

            const objPageData = this._data.get(nPageIndex) || this._createRecord();

            objPageData.outsideHashes.set(strHash, nHeight);

            const nHigestPageHeight = this.getHigestPageHeight(nParentHeight);

            if (nParentHeight === nHigestPageHeight) {
                objPageData.topHashes.add(strParentHash);
            } else {
                objPageData.insideHashes.set(strParentHash, nParentHeight);
            }

            this._data.set(nPageIndex, objPageData);
        }

        _createRecord() {
            return {
                topHashes: new Set(),
                insideHashes: new Map(),
                // children from other pages
                // won't use it, just for a reference
                outsideHashes: new Map()
            };
        }

        _getHigestPageIndex() {
            return Math.max(...this._data.keys());
        }

        _getLowestPageIndex() {
            return Math.min(...this._data.keys());
        }

        // _getLowestFullPageIndex() {
        //     const arrPageIndexesDesc = [...this._data.keys()].sort((a, b) => b - a);

        //     // if we have a gap in the pages and filled page near genesis
        //     let nSequenceBreak = arrPageIndexesDesc[0];
        //     for (const nPageIndex of arrPageIndexesDesc) {
        //         if (!this._data.has(nPageIndex - 1)) {
        //             nSequenceBreak = nPageIndex;
        //             break;
        //         }
        //     }

        //     const arrPageIndexesToCheck = arrPageIndexesDesc
        //         .filter(nPageIndex => nPageIndex >= nSequenceBreak)
        //         .slice(1);

        //     // full page could contain more than DAG_INDEX_STEP hashes,
        //     // but if page size is less than DAG_INDEX_STEP page is defenitely not full
        //     for (const nPageIndex of arrPageIndexesToCheck) {
        //         if (this._data.get(nPageIndex).size < Constants.DAG_INDEX_STEP) {
        //             return nPageIndex - 1;
        //         }
        //     }

        //     return arrPageIndexesToCheck[arrPageIndexesToCheck.length - 1];
        // }

        _getPageIndex(nBlockHeight) {
            return Math.floor(nBlockHeight / Constants.DAG_INDEX_STEP);
        }

        getHigestPageHeight(nBlockHeight) {
            return this._getPageIndex(nBlockHeight) * Constants.DAG_INDEX_STEP + Constants.DAG_INDEX_STEP - 1;
        }

        getLowestPageHeight(nPageIndex) {
            return nPageIndex * Constants.DAG_INDEX_STEP;
        }

        _range(nStart, nStop) {
            return Array.from({length: nStop - nStart + 1}, (_, i) => nStart + i);
        }
    };
};
