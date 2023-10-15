'use strict';

const typeforce = require('typeforce');
const types = require('../types');

module.exports = ({Constants}) => {
    return class MainDagIndex {
        constructor() {
            this._data = new Map();
        }

        addBlock(blockInfo) {
            typeforce(types.BlockInfo, blockInfo);

            const nHeight = blockInfo.getHeight();
            const strHash = blockInfo.getHash();

            const nPageIndex = this._getPageIndex(nHeight);

            if (!this._data.has(nPageIndex)) {
                this._data.set(nPageIndex, new Map());
            }

            this._data.get(nPageIndex).set(strHash, nHeight);
        }

        hasBlock(nHeight, strHash) {
            typeforce('Number', nHeight);
            typeforce(types.Str64, strHash);

            const nPageIndex = this._getPageIndex(nHeight);

            if (!this._data.has(nPageIndex)) return false;

            return this._data.get(nPageIndex).has(strHash);
        }

        removeBlock(nHeight, strHash) {
            throw new Error('Not implemented');
        }

        couldBeCompacted(nDagOrder) {
            return (
                nDagOrder >
                Constants.DAG_INDEX_STEP *
                    (Constants.DAG_HIGHEST_PAGES2KEEP +
                        Constants.DAG_LOWEST_PAGES2KEEP +
                        Constants.DAG_DELTA_PAGES2KEEP)
            );
        }

        getPagesToRestore(bRestoreOnlyLowest = false) {
            const nHigestPageIndex = this._getHigestPageIndex();
            const nLowestPageIndex = this._getLowestPageIndex();

            if (nHigestPageIndex === nLowestPageIndex) return [nHigestPageIndex];

            if (
                nHigestPageIndex - Constants.DAG_HIGHEST_PAGES2KEEP <=
                nLowestPageIndex + Constants.DAG_LOWEST_PAGES2KEEP + 1
            ) {
                return this._range(nLowestPageIndex, nHigestPageIndex).sort((a, b) => b - a);
            }

            const nLowestFullPageIndex = this._getLowestFullPageIndex();

            const arrLowestPages = this._range(
                Math.max(nLowestPageIndex, nLowestFullPageIndex - Constants.DAG_LOWEST_PAGES2KEEP),
                Math.max(nLowestPageIndex + Constants.DAG_LOWEST_PAGES2KEEP, nLowestFullPageIndex)
            );

            if (bRestoreOnlyLowest) {
                return arrLowestPages.sort((a, b) => b - a);
            }

            const arrHigestPages = this._range(nHigestPageIndex - Constants.DAG_HIGHEST_PAGES2KEEP, nHigestPageIndex);

            return arrLowestPages.concat(arrHigestPages).sort((a, b) => b - a);
        }

        getPagesForSequence(nLowestHeight, nHighestHeight) {
            typeforce('Number', nLowestHeight);
            typeforce('Number', nHighestHeight);

            const nLowestPageIndex = this._getLowestPageIndex();
            const nHigestPageIndex = this._getHigestPageIndex();

            const nLowestRequestedPageIndex = this._getPageIndex(nLowestHeight);
            const nHighestRequestedPageIndex = this._getPageIndex(nHighestHeight);

            const nStart = nLowestRequestedPageIndex < nLowestPageIndex ? nLowestPageIndex : nLowestRequestedPageIndex;
            const nStop = nHighestRequestedPageIndex > nHigestPageIndex ? nHigestPageIndex : nHighestRequestedPageIndex;

            return this._range(nStart, nStop).sort((a, b) => b - a);
        }

        getPageHashes(nPageIndex) {
            if (!this._data.has(nPageIndex)) return [];

            // тут можно отсортировать по высоте, но это замедлит обработку
            return [...this._data.get(nPageIndex).keys()];
        }

        _getHigestPageIndex() {
            return Math.max(...this._data.keys());
        }

        _getLowestPageIndex() {
            return Math.min(...this._data.keys());
        }

        _getLowestFullPageIndex() {
            // const arrPageIndexesAsc = Object.keys(this._data).sort((a, b) => a - b);
            const arrPageIndexesDesc = [...this._data.keys()]
                .sort((a, b) => b - a);

            // if we have a gap in the pages and filled page near genesis
            let nSequenceBreak = arrPageIndexesDesc[0];
            for (const nPageIndex of arrPageIndexesDesc) {
                if (!this._data.has(nPageIndex - 1)) {
                    nSequenceBreak = nPageIndex;
                    break;
                }
            }

            const arrPageIndexesToCheck = arrPageIndexesDesc
                .filter(nPageIndex => nPageIndex >= nSequenceBreak)
                .slice(1);

            for (const nPageIndex of arrPageIndexesToCheck) {
                if (this._data.get(nPageIndex).size < Constants.DAG_INDEX_STEP) {
                    return nPageIndex - 1;
                }
            }

            return arrPageIndexesToCheck[arrPageIndexesToCheck.length - 1];
        }

        _getPageIndex(nBlockHeight) {
            return Math.floor(nBlockHeight / Constants.DAG_INDEX_STEP);
        }

        _range(nStart, nStop) {
            return Array.from({length: nStop - nStart + 1}, (_, i) => nStart + i);
        }
    };
};
