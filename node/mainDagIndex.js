'use strict';

const typeforce = require('typeforce');
const types = require('../types');

module.exports = ({Constants}) => {
    return class MainDagIndex {
        constructor() {
            this._data = {};
        }

        addBlock(blockInfo) {
            typeforce(types.BlockInfo, blockInfo);

            const nHeight = blockInfo.getHeight();
            const strHash = blockInfo.getHash();

            const nPageIndex = this._getPageIndex(nHeight);

            if (!this._data[nPageIndex]) {
                this._data[nPageIndex] = {};
            }

            if (!this._data[nPageIndex][nHeight]) {
                this._data[nPageIndex] = {...this._data[nPageIndex], [[nHeight]]: [strHash]};
            } else {
                this._data[nPageIndex] = {
                    ...this._data[nPageIndex],
                    [[nHeight]]: [...new Set([...this._data[nPageIndex][nHeight], strHash])]
                };
            }
        }

        hasBlock(blockInfo) {
            typeforce(types.BlockInfo, blockInfo);

            const nHeight = blockInfo.getHeight();
            const strHash = blockInfo.getHash();

            const nPageIndex = this._getPageIndex(nHeight);

            if (!this._data[nPageIndex] || !this._data[nPageIndex][nHeight]) return false;

            return this._data[nPageIndex][nHeight].includes(strHash);
        }

        removeBlock(blockInfo) {
            typeforce(types.BlockInfo, blockInfo);
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

        getPagesToRestore() {
            const nHigestPageIndex = this._getHigestPageIndex();
            const nLowestPageIndex = this._getLowestPageIndex();

            if (nHigestPageIndex === nLowestPageIndex) return [nHigestPageIndex];

            if (
                nHigestPageIndex - Constants.DAG_HIGHEST_PAGES2KEEP <=
                nLowestPageIndex + Constants.DAG_LOWEST_PAGES2KEEP + 1
            ) {
                return this._range(nLowestPageIndex, nHigestPageIndex).sort((a, b) => b - a);
            }

            const arrLowestPages = this._range(nLowestPageIndex, nLowestPageIndex + Constants.DAG_LOWEST_PAGES2KEEP);
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

            return this._range(nStart, nStop).sort((a, b) => b - a)
        }

        getPageHashes(nPageIndex) {
            const objPage = this._data[nPageIndex];
            if (!objPage) return [];

            const arrKeys = Object.keys(objPage).sort((a, b) => b - a);
            const arrHashes = arrKeys.map(index => objPage[index]);

            return [].concat(...arrHashes);
        }

        _getHigestPageIndex() {
            return Math.max(...Object.keys(this._data));
        }

        _getLowestPageIndex() {
            return Math.min(...Object.keys(this._data));
        }

        _getPageIndex(nBlockHeight) {
            return Math.floor(nBlockHeight / Constants.DAG_INDEX_STEP);
        }

        _range(nStart, nStop) {
            return Array.from({length: nStop - nStart + 1}, (_, i) => nStart + i);
        }
    };
};
