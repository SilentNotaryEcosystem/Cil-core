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
                    [[nHeight]]: [...new Set(...this._data[nPageIndex][nHeight], strHash)]
                };
            }
        }

        removeBlock(blockInfo) {
            typeforce(types.BlockInfo, blockInfo);
            throw new Error('not implemented');
        }

        // тут можно на итератор переделать и обрезать блоки до стартового,
        // которые нам не нужны сделаю чуть позже
        getPageHashes(nStartHeight, nEndHeight) {
            typeforce('Number', nStartHeight);
            typeforce('Number', nEndHeight);

            const nStartPageIndex = this._getPageIndex(nStartHeight);
            const nEndPageIndex = this._getPageIndex(nEndHeight);

            let arrResult = [];
            for (let i = nStartPageIndex; i <= nEndPageIndex; i++) {
                const objPage = this._data[i];
                if (!objPage) continue;

                arrResult = arrResult.concat(...Object.values(objPage));
            }

            return arrResult;
        }

        _getPageIndex(nBlockHeight) {
            return Math.floor(nBlockHeight / Constants.DAG_INDEX_STEP);
        }
    };
};
