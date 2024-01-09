'use strict';

const typeforce = require('typeforce');
const debugLib = require('debug');
const {Dag} = require('dagjs');

const types = require('../types');

const debug = debugLib('mainDag:');

module.exports = ({Constants}) =>
    class MainDag {
        constructor() {
            this._dag = new Dag();
            this._dag.testForCyclic = false;
        }

        get order() {
            return this._dag.order;
        }

        get size() {
            return this._dag.size;
        }

        addBlock(blockInfo) {
            typeforce(types.BlockInfo, blockInfo);
            const blockHash = blockInfo.getHash();

            if (blockHash !== Constants.GENESIS_BLOCK) {
                for (let strHash of blockInfo.parentHashes) {
                    this._dag.add(blockHash, strHash);
                }
            } else {
                if (!this._dag.hasVertex(blockHash)) this._dag.addVertex(blockHash);
            }
            this._dag.saveObj(blockHash, blockInfo);
        }

        setBlockInfo(blockInfo) {
            typeforce(types.BlockInfo, blockInfo);

            this._dag.saveObj(blockInfo.getHash(), blockInfo);
        }

        getBlockInfo(strHash) {
            typeforce(types.Str64, strHash);
            return this._dag.readObj(strHash);
        }

        getParents(strHash) {
            typeforce(types.Str64, strHash);

            return this._dag.readObj(strHash).parentHashes;
        }

        getChildren(strHash) {
            typeforce(types.Str64, strHash);

            return this._dag.edgesTo(strHash).tips;
        }

        getBlockHeight(strHash) {
            typeforce(types.Str64, strHash);

            return this._dag.readObj(strHash).getHeight();
        }

        removeBlock(strHash) {
            typeforce(types.Str64, strHash);

            this._dag.removeVertex(strHash);
        }
    };
