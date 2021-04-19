'use strict';
const assert = require('assert');
const typeforce = require('typeforce');
const debugLib = require('debug');
const v8 = require('v8');

const types = require('../types');
const {arrayIntersection, getMapsKeysUnique} = require('../utils');

// Could be used for undo blocks

module.exports = ({UTXO, Contract, TxReceipt, CoinHistory}) =>
    class PatchDB {
        constructor(nConciliumId) {
            this._data = {
                coins: new Map()
            };

            // it will keep tracks which tx spend particular output
            this._mapSpentUtxos = new Map();

            this._mapConciliumLevel = new Map();
            this.setConciliumId(nConciliumId);

            this._mapContractStates = new Map();
            this._mapTxReceipts = new Map();

            this._nonce = 0;

            this._coinHistory = new CoinHistory();
        }

        /**
         * Used for tests only
         *
         * @param {String} strData
         * @returns {*}
         */
        static deserialize(strData) {
            const patch = v8.deserialize(Buffer.from(strData, 'hex'));
            patch.__proto__ = this.prototype;

            const arrUtxos = [];
            patch._data.coins.forEach((value, key) => arrUtxos.push([key, UTXO.createFromData(value)]));
            patch._data.coins = new Map(arrUtxos);

            patch._mapContractStates.forEach(
                (value, key) => patch._mapContractStates.set(key, Contract.createFromData(value)));
            patch._mapTxReceipts.forEach(
                (value, key) => patch._mapTxReceipts.set(key, TxReceipt.createFromData(value)));

            return patch;
        }

        /**
         * Used for tests only
         *
         * @returns {String}
         */
        serialize() {
            return v8.serialize(this).toString('hex');
        }

        /**
         * TODO: reminder. lock DB for all UTXO with mutex right after forming mapUtxos
         * TODO: and release it after applying patch or UTXO DB could be corrupted!
         *
         * @param {UTXO} utxo
         * @param {Number} nTxOutput - index in UTXO that we spend
         * @param {String | Buffer} txHashSpent - hash of tx that spent this output (used for merging patches).
         */
        spendCoins(utxo, nTxOutput, txHashSpent) {
            typeforce('Number', nTxOutput);
            typeforce(types.Hash256bit, txHashSpent);

            if (typeof txHashSpent === 'string') txHashSpent = Buffer.from(txHashSpent, 'hex');

            const strHash = utxo.getTxHash();
            const utxoCopy = this.getUtxo(strHash) || utxo.clone();
            utxoCopy.spendCoins(nTxOutput);

            // rewrite reference
            this._data.coins.set(strHash, utxoCopy);

            this._setSpentOutput(utxo.getTxHash(), nTxOutput, txHashSpent);
        }

        /**
         *
         * @param {String | Buffer} txHash
         * @param {Number} idx
         * @param {Coins} coins
         */
        createCoins(txHash, idx, coins) {
            typeforce(typeforce.tuple(types.Hash256bit, 'Number'), [txHash, idx]);

            if (Buffer.isBuffer(txHash)) txHash = txHash.toString('hex');

            const utxo = this._data.coins.get(txHash) || new UTXO({txHash});
            utxo.addCoins(idx, coins);

            this._data.coins.set(txHash, utxo);

            this._coinHistory.recordReceive(txHash, idx, coins);
        }

        /**
         *
         * @returns {Map} of UTXOs. keys are hashes, values UTXOs
         */
        getCoins() {
            return this._data.coins;
        }

        /**
         *
         * @param {String | Buffer} txHash
         * @returns {UTXO}
         */
        getUtxo(txHash) {
            typeforce(types.Hash256bit, txHash);

            const strHash = Buffer.isBuffer(txHash) ? txHash.toString('hex') : txHash;
            return this._data.coins.get(strHash);
        }

        /**
         *
         * @param {UTXO} utxo
         */
        setUtxo(utxo) {
            typeforce(types.UTXO, utxo);

            this._data.coins.set(utxo.getTxHash(), utxo.clone());
            const txHash = utxo.getTxHash();
            for (let idx of utxo.getIndexes()) {
                this._coinHistory.recordReceive(txHash, idx, utxo.coinsAtIndex(idx));
            }
        }

        /**
         * Important! resultPatch doesn't contain _conciliumId! Because we merge patches for various purposes.
         * For new block we couldn't predict _conciliumId
         *
         * @param {PatchDB} patch - to merge with this
         * @param {Boolean} bPreferPatchData - force using contracts from "patch" (used only for processing block)
         * @return {PatchDB} NEW patch!
         */
        merge(patch, bPreferPatchData = false) {

            // same concilium + same level. it's definitely error!
            if (this._conciliumId !== undefined && patch._conciliumId !== undefined && !bPreferPatchData) {
                assert(
                    this._conciliumId !== patch._conciliumId ||
                    this.getLevel(this._conciliumId) !== patch.getLevel(patch._conciliumId),
                    'It seems we have unexpected fork!'
                );
            }

            const resultPatch = new PatchDB();

            // merge conciliumLevels
            const arrConciliumIds = getMapsKeysUnique(this._mapConciliumLevel, patch._mapConciliumLevel);
            for (let conciliumId of arrConciliumIds) {
                resultPatch._mapConciliumLevel.set(
                    conciliumId,
                    Math.max(this._mapConciliumLevel.get(conciliumId) || 0,
                        patch._mapConciliumLevel.get(conciliumId) || 0
                    )
                );
            }

            // merge UTXOs
            const arrThisCoinsHashes = Array.from(this._data.coins.keys());
            const arrAnotherCoinsHashes = Array.from(patch._data.coins.keys());

            const setUnionHashes = new Set(arrThisCoinsHashes.concat(arrAnotherCoinsHashes));
            for (let coinHash of setUnionHashes) {

                if ((this._data.coins.has(coinHash) && !patch._data.coins.has(coinHash)) ||
                    (!this._data.coins.has(coinHash) && patch._data.coins.has(coinHash))) {

                    // only one patch have this utxo -> put it in result
                    const utxo = this._data.coins.get(coinHash) || patch._data.coins.get(coinHash);
                    const mapSpentOutputs = this._getSpentOutputs(coinHash).size ?
                        this._getSpentOutputs(coinHash) : patch._getSpentOutputs(coinHash);

                    resultPatch._data.coins.set(coinHash, utxo.clone());
                    for (let [idx, hash] of mapSpentOutputs) resultPatch._setSpentOutput(coinHash, idx, hash);

                } else {

                    // both has
                    const utxoMy = this.getUtxo(coinHash);
                    const utxoHis = patch.getUtxo(coinHash);

                    // if both version of UTXO has index -> put it in result
                    // if only one has - this means it's spent -> don't put it in result
                    // if both doesn't have - check it for double spend. if found - throws
                    // so if we need only intersection we could travers any for indexes

                    // process common (both has) indexes. so we could choose any to pick coins
                    const arrUnspentIndexes = arrayIntersection(
                        Array.from(utxoMy.getIndexes()),
                        Array.from(utxoHis.getIndexes())
                    );
                    resultPatch.setUtxo(new UTXO({txHash: coinHash}));
                    for (let idx of arrUnspentIndexes) {
                        resultPatch.createCoins(coinHash, idx, utxoMy.coinsAtIndex(idx));
                    }

                    // all good utxos added to resulting patch now search for double spends
                    const mapMySpentOutputs = this._getSpentOutputs(coinHash);
                    const mapHisSpentOutputs = patch._getSpentOutputs(coinHash);
                    const arrSpentIndexes = arrayIntersection(
                        Array.from(mapMySpentOutputs.keys()),
                        Array.from(mapHisSpentOutputs.keys())
                    );
                    for (let idx of arrSpentIndexes) {
                        assert(
                            mapMySpentOutputs.get(idx).equals(mapHisSpentOutputs.get(idx)),
                            `Patch merge: conflict on ${coinHash} idx ${idx}`
                        );
                    }

                    // no conflicts - store all spending into resulting patch
                    for (let [idx, hash] of mapMySpentOutputs) resultPatch._setSpentOutput(coinHash, idx, hash);
                    for (let [idx, hash] of mapHisSpentOutputs) resultPatch._setSpentOutput(coinHash, idx, hash);
                }
            }

            // merge contracts
            const arrContractAddresses = getMapsKeysUnique(this._mapContractStates, patch._mapContractStates);
            for (let strAddr of arrContractAddresses) {

                let winnerContract;

                // contract belongs always to one concilium
                const contractThis = this.getContract(strAddr);
                const contractPatch = patch.getContract(strAddr);
                if (contractThis && contractPatch) {
                    assert(
                        contractThis.getConciliumId() === contractPatch.getConciliumId(),
                        'Contract belongs to different conciliums'
                    );

                    winnerContract = bPreferPatchData ||
                                     patch.getLevel(contractPatch.getConciliumId()) >=
                                     this.getLevel(contractThis.getConciliumId())
                        ? contractPatch
                        : contractThis;
                } else {

                    // no conflict
                    winnerContract = contractThis || contractPatch;
                }

                resultPatch.setContract(winnerContract.clone());
            }

            // merge receipts
            // TODO: think is TX collisions possible?
            const arrTxHashes = getMapsKeysUnique(this._mapTxReceipts, patch._mapTxReceipts);
            for (let strHash of arrTxHashes) {

                // receipts should be same (if no tx collision)
                const receiptThis = this._mapTxReceipts.get(strHash);
                const receiptPatch = patch._mapTxReceipts.get(strHash);
                if (receiptThis && receiptPatch) {
                    assert(receiptThis.equals(receiptPatch), 'patch.merge: Tx Collision detected');
                }
                const receipt = receiptThis || receiptPatch;
                patch._mapTxReceipts.get(strHash);
                resultPatch.setReceipt(strHash, receipt);
            }

            if (this._coinHistory) resultPatch._coinHistory = this._coinHistory.mergeHistory(patch._coinHistory);

            return resultPatch;
        }

        /**
         * We need it to prevent patch growth.
         * When block becomes stable - we apply it to storage and purge those UTXOs from derived patches.
         * Now it's quite rough: remove only equal UTXO
         *
         * @param {PatchDB} patch - another instance, that we remove from current.
         */
        purge(patch) {
            const arrAnotherCoinsHashes = Array.from(patch._data.coins.keys());
            for (let hash of arrAnotherCoinsHashes) {
                const utxo = this.getUtxo(hash);
                if (utxo) {
                    if (utxo.equals(patch.getUtxo(hash)) &&
                        this._spendingTnxsEqual(this._getSpentOutputs(hash), patch._getSpentOutputs(hash))) {

                        // remove it, if unchanged since (patch)
                        this.removeUtxo(utxo.getTxHash());
                    } else {

                        // remove indexes from UTXO
                        const setUnspentIndexes = new Set(utxo.getIndexes());
                        for (let [idx, buffHashSpent] of patch._getSpentOutputs(utxo.getTxHash())) {
                            if (setUnspentIndexes.has(idx)) this.spendCoins(utxo, idx, buffHashSpent);
                        }
                    }
                }
            }

            // remove contracts
            for (let contractAddr of patch._mapContractStates.keys()) {
                if (this._mapContractStates.has(contractAddr)) {

                    // we could check patch level for contract's conciliumId (faster, but could keep unchanged data)
                    // or compare entire data (could be time consuming)
                    // contract belong only to one concilium. so conciliumId is same for both
                    const thisContract = this.getContract(contractAddr);
                    const patchContract = patch.getContract(contractAddr);

                    if (thisContract && patchContract &&
                        thisContract.getDataBuffer().equals(patchContract.getDataBuffer())) {
                        this._mapContractStates.delete(contractAddr);
                    }
                }
            }

            // remove receipts
            for (let strHash of patch._mapTxReceipts.keys()) {
                if (this._mapTxReceipts.has(strHash)) this._mapTxReceipts.delete(strHash);
            }

            this._coinHistory.purgeHistory(patch._coinHistory);
        }

        /**
         * We'll keep tracks in which {buffTxHashSpent} output {nTxOutput} of utxo with {strUtxoHash} was spent!
         *
         * @param {String} strUtxoHash
         * @param {Number} nTxOutput
         * @param {Buffer} buffTxHashSpent - TX that spent nTxOutput of strUtxoHash
         * @private
         */
        _setSpentOutput(strUtxoHash, nTxOutput, buffTxHashSpent) {
            let mapSpent = this._mapSpentUtxos.get(strUtxoHash);
            if (!mapSpent) mapSpent = new Map();
            mapSpent.set(nTxOutput, buffTxHashSpent);
            this._mapSpentUtxos.set(strUtxoHash, mapSpent);
        }

        /**
         *
         * @param {String} strUtxoHash
         * @returns {Map<Number, Buffer>} map <Index, buffTxHashSpentThisIndex>
         * @private
         */
        _getSpentOutputs(strUtxoHash) {
            return this._mapSpentUtxos.get(strUtxoHash) || new Map();
        }

        /**
         * this function used to compare maps of spended outputs @see _getSpentOutputs
         *
         * @param {Map} thisMapSpent - @see this._getSpentOutputs
         * @param {Map} patchMapSpent - @see this._getSpentOutputs
         * @returns {boolean} - true - equal. i.e. output indexes was spen in same txns
         * @private
         */
        _spendingTnxsEqual(thisMapSpent, patchMapSpent) {
            if (thisMapSpent.size !== patchMapSpent.size) return false;

            for (let [nTxOutput, buffTxHashSpent] of thisMapSpent) {
                const patchBuffSpendingTx = patchMapSpent.get(nTxOutput);
                if (!patchBuffSpendingTx || !patchBuffSpendingTx.equals(buffTxHashSpent)) return false;
            }
            return true;
        }

        /**
         * return how complex to build this patch.
         * now we use numbers of spent outputs
         * in case of conflict we'll keep more complex (if more important metrics are equal)
         *
         * @returns {Number}
         */
        getComplexity() {
            return [...this._mapSpentUtxos.keys()]
                .reduce((result, strUtxoHash) => result + this._mapSpentUtxos.get(strUtxoHash).size, 0);
        }

        setConciliumId(nId) {

            // invoked from constructor, which invoked from merge
            if (nId === undefined) return;

            // it's equal block.conciliumId
            assert(this._conciliumId === undefined, '"conciliumId" already specified!');
            this._conciliumId = nId;

            // patch could be derived from various blocks, we'll maintain level for every concilium
            // we'll use it to resolve conflicts while merging contract data.
            // for same concilium: the highest level will win
            // for different concilium i have no solution yet
            // it should be just monotonic, nobody cares about values
            const conciliumLevel = (this._mapConciliumLevel.get(nId) || 0) + 1;
            this._mapConciliumLevel.set(nId, conciliumLevel);
        }

        getConciliumId() {
            return this._conciliumId;
        }

        /**
         * @see comment for this.setConciliumId
         *
         * @param {Number} nConciliumId
         * @returns {any}
         */
        getLevel(nConciliumId) {
            nConciliumId = nConciliumId === undefined ? this._conciliumId : nConciliumId;
            return this._mapConciliumLevel.get(nConciliumId);
        }

        /**
         *
         * @param {Contract} contract
         */
        setContract(contract) {
            const foundContract = this._mapContractStates.get(contract.getStoredAddress());

            if (foundContract) {
                foundContract.updateData(contract.getData());
            } else {
                this._mapContractStates.set(contract.getStoredAddress(), contract);
            }
        }

        /**
         *
         * @param {String | Buffer} contractAddr
         * @return {any}
         */
        getContract(contractAddr) {
            typeforce(typeforce.oneOf('String', types.Address), contractAddr);

            if (Buffer.isBuffer) contractAddr = contractAddr.toString('hex');
            return this._mapContractStates.get(contractAddr);
        }

        /**
         *
         * @return {IterableIterator<any>}
         */
        getContracts() {
            return this._mapContractStates.entries();
        }

        /**
         *
         * @param {String} strTxHash
         * @returns {TxReceipt}
         */
        getReceipt(strTxHash) {
            typeforce(types.Str64, strTxHash);

            return this._mapTxReceipts.get(strTxHash);
        }

        /**
         *
         * @param {String} strTxHash
         * @param {TxReceipt} receipt
         */
        setReceipt(strTxHash, receipt) {
            typeforce(types.Str64, strTxHash);

            const sameTxReceipt = this._mapTxReceipts.get(strTxHash);

            // first time encountered
            if (!sameTxReceipt) {
                this._mapTxReceipts.set(strTxHash, receipt);
                return;
            }

            assert(sameTxReceipt.isSuccessful(), `You shouldn't continue exec of already failed TX ${strTxHash}`);
            sameTxReceipt.merge(receipt);

            return sameTxReceipt;
        }

        /**
         *
         * @return {IterableIterator<any>}
         */
        getReceipts() {
            return this._mapTxReceipts.entries();
        }

        /**
         *
         * @param {PatchDB} stablePatch - @see Storage.getUtxosPatch
         * @throws assertion error if find spending of indexes that already absent in stablePatch
         */
        validateAgainstStable(stablePatch) {
            for (let hash of this.getCoins().keys()) {

                // it could be UTXO from pending parent blocks. we'll check in later, when it become stable
                const utxo = stablePatch.getUtxo(hash);
                if (!utxo) continue;

                const mapPatchSpentOutputs = this._getSpentOutputs(hash);

                // we can't spend indexes that aren't on "stable" utxo (utxo on disk)
                for (let [idx] of mapPatchSpentOutputs) {
                    assert(utxo.coinsAtIndex(idx));
                }
            }
        }

        getNonce() {
            return this._nonce++;
        }

        hasUtxos(arrUtxos) {
            const res = arrUtxos.filter(hash => this._data.coins.has(hash.toString('hex'))).length;
            return res;
        }

        removeUtxo(strHash) {
            this._data.coins.delete(strHash);
            this._mapSpentUtxos.delete(strHash);

        }

        get coinHistory() {
            return this._coinHistory;
        }
    };
