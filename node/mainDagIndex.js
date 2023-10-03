'use strict';

const assert = require('assert');
const typeforce = require('typeforce');
const types = require('../types');

module.exports = ({Constants, Crypto}) => {
    const {MAIN_DAG_INDEX_STEP} = Constants;
    return class MainDagIndex {
        constructor(props) {
            const {storage} = props;
            assert(storage, 'MainDagIndex constructor requires Storage instance!');

            this._storage = storage;
            this._strDagPrefix = Crypto.createHash(Date.now().toString());
            this._pagesCache = {}; // Store MAIN_DAG_PAGES_IN_MEMORY
            this._childrenToWrite = {}; // if we don't know parent height
        }

        async addBlock(blockInfo) {
            typeforce(types.BlockInfo, blockInfo);

            const nBlockHeight = blockInfo.getHeight();
            const strBlockHash = blockInfo.getHash();

            if (strBlockHash !== Constants.GENESIS_BLOCK) {
                // add parents

                for (const strParentBlockHash of blockInfo.parentHashes) {
                    const objParentBlock = await this._storage
                        .getDagBlockInfo(this._strDagPrefix, strParentBlockHash)
                        .catch(() => null);

                    if (!objParentBlock) {
                        this._childrenToWrite[strParentBlockHash] = !this._childrenToWrite[strParentBlockHash]
                            ? {[strBlockHash]: nBlockHeight}
                            : {...this._childrenToWrite[strParentBlockHash], [strBlockHash]: nBlockHeight};
                        continue;
                    }

                    const nParentBlockHeight = objParentBlock.getHeight();

                    const arrParentHashes = (await this._getMainDagPageIndex(nParentBlockHeight)) || {};

                    const objIndex = arrParentHashes[strParentBlockHash];

                    if (!objIndex) {
                        arrParentHashes[strParentBlockHash] = {[strBlockHash]: nBlockHeight};
                        await this._storage.incMainDagIndexOrder(this._strDagPrefix);
                    } else {
                        arrParentHashes[strParentBlockHash] = {...objIndex, [strBlockHash]: nBlockHeight};
                    }

                    await this._setMainDagPageIndex(nParentBlockHeight, arrParentHashes);
                }
            }

            // process block
            const objHashes = (await this._getMainDagPageIndex(nBlockHeight)) || {};

            const objBlock = objHashes[strBlockHash];
            if (!objBlock) {
                objHashes[strBlockHash] = {...(this._childrenToWrite[strBlockHash] || {})};
                if (this._childrenToWrite[strBlockHash]) {
                    delete this._childrenToWrite[strBlockHash];
                }
                await this._storage.incMainDagIndexOrder(this._strDagPrefix);
            }

            await this._storage.saveDagBlockInfo(this._strDagPrefix, blockInfo);
            await this._setMainDagPageIndex(nBlockHeight, objHashes);
        }

        async removeBlock(blockInfo) {
            typeforce(types.BlockInfo, blockInfo);

            // TODO: remove BI

            const strHash = blockInfo.getHash();
            const nBlockHeight = blockInfo.getHeight();

            if (this._childrenToWrite[strHash]) {
                delete this._childrenToWrite[strHash];
            }

            const objHashes = await this._getMainDagPageIndex(nBlockHeight);
            if (!objHashes) return;

            // если это единственный блок то тут порядок должен на 2 величины измениться
            if (objHashes[strHash]) {
                delete objHashes[strHash];
                await this._setMainDagPageIndex(nBlockHeight, objHashes);
                await this._storage.decMainDagIndexOrder(this._strDagPrefix);
            }

            for (const strParentBlockHash of blockInfo.parentHashes) {
                const objParentBlock = await this._storage
                    .getDagBlockInfo(this._strDagPrefix, strParentBlockHash)
                    .catch(() => null);
                if (!objParentBlock) continue;

                const nParentBlockHeight = objParentBlock.getHeight();

                const arrParentHashes = await this._getMainDagPageIndex(nParentBlockHeight);
                if (!arrParentHashes) continue;

                const objChildren = arrParentHashes[strParentBlockHash];

                if (objChildren[strHash]) {
                    delete objChildren[strHash];
                    if (Object.keys(objChildren).length === 0) {
                        delete arrParentHashes[strParentBlockHash];
                        await this._storage.decMainDagIndexOrder(this._strDagPrefix);
                    } else {
                        arrParentHashes[strParentBlockHash] = objChildren;
                    }

                    await this._setMainDagPageIndex(nBlockHeight, arrParentHashes);
                }
            }

            await this._storage.removeDagBlockInfo(this._strDagPrefix, strHash);
        }

        async getChildren(strHash, nBlockHeight, bIsDirectOnly = false) {
            typeforce(types.Str64, strHash);
            typeforce('Number', nBlockHeight);

            const indexPage = await this._getMainDagPageIndex(nBlockHeight);

            const objChildren = indexPage && indexPage[strHash];

            if (!objChildren) return {};
            if (!bIsDirectOnly) return objChildren;

            const objDirectChildren = {};
            for (const strHash in objChildren) {
                if (objChildren[strHash] - nBlockHeight === 1) {
                    objDirectChildren[strHash] = objChildren[strHash];
                }
            }

            return objDirectChildren;
        }

        async getBlockHeight(strHash) {
            typeforce(types.Str64, strHash);

            const objBlockInfo = await this._storage.getDagBlockInfo(this._strDagPrefix, strHash).catch(() => null);
            if (!objBlockInfo) return null;

            return objBlockInfo.getHeight();
        }

        async setBlockInfo(blockInfo) {
            typeforce(types.BlockInfo, blockInfo);

            await this._storage.saveDagBlockInfo(this._strDagPrefix, blockInfo);
        }

        async getBlockInfo(strHash) {
            typeforce(types.Str64, strHash);

            return await this._storage.getDagBlockInfo(this._strDagPrefix, strHash).catch(() => null);
        }

        async getOrder() {
            return await this._storage.getMainDagIndexOrder(this._strDagPrefix);
        }

        _getPageIndexByHeight(nHeight) {
            return Math.floor(nHeight / MAIN_DAG_INDEX_STEP) * (MAIN_DAG_INDEX_STEP - 1);
        }

        async _getMainDagPageIndex(nBlockHeight) {
            const nPageIndex = this._getPageIndexByHeight(nBlockHeight);

            const objPage = this._pagesCache[nPageIndex];

            if (objPage) {
                objPage.timestamp = Date.now();
                return objPage.data;
            }

            this._releaseOldCachePages();

            const pageData = await this._storage.getMainDagPageIndex(this._strDagPrefix, nPageIndex);

            if (!pageData) return null;

            // add to cache
            this._pagesCache[nPageIndex] = {
                timestamp: Date.now(),
                data: pageData
            };

            return pageData;
        }

        async _setMainDagPageIndex(nBlockHeight, objHashes) {
            if (Object.keys(objHashes).length === 0) return;

            const nPageIndex = this._getPageIndexByHeight(nBlockHeight);

            if (!this._pagesCache[nPageIndex]) {
                this._releaseOldCachePages();
            }

            // add to cache
            this._pagesCache[nPageIndex] = {
                timestamp: Date.now(),
                data: objHashes
            };

            await this._storage.setMainDagPageIndex(this._strDagPrefix, nPageIndex, objHashes);
        }

        _releaseOldCachePages() {
            // delete old pages from cache if it's full
            if (Object.keys(this._pagesCache).length > Constants.MAIN_DAG_PAGES_IN_MEMORY - 1) {
                const arrOldIndexes = Object.entries(this._pagesCache)
                    .map(([key, value]) => ({
                        timestamp: value.timestamp,
                        index: key
                    }))
                    .sort((a, b) => a.timestamp - b.timestamp)
                    .slice(Constants.MAIN_DAG_PAGES_IN_MEMORY - 1)
                    .map(item => item.index);

                for (const index of arrOldIndexes) {
                    delete this._pagesCache[index];
                }
            }
        }
    };
};
