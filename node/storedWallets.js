'use strict';
const assert = require('assert');
const Tick = require('tick-tock');

const {finePrintUtxos, createObjInvocationCode, stripAddressPrefix} = require('../utils');

const checkRequiredParameters = (objParams, arrRequired) => {
    for (let key of arrRequired) {
        if (!objParams.hasOwnProperty(key)) throw (`Required parameter ${key} is missing`);
    }
};

module.exports = ({Crypto, Constants, Transaction}) =>
    class StoredWallet {
        constructor(props) {
            const {storage} = props;
            assert(storage, 'StoredWallet constructor requires Storage instance!');

            this._storage = storage;
            this._mapAccountPasswords = new Map();
            this._timer = new Tick();

            this._nFeePerInput = Constants.fees.TX_FEE * 0.12;
            this._nFeePerReceiver = Constants.fees.TX_FEE * 0.04;
        }

        async getNewAddress() {
            return Crypto.createKeyPair();
        }

        async unlockAccount(strAccountName, strPassword, nSeconds = 60) {
            await this._ensureAccount(strAccountName);

            const strPeriod = `${nSeconds} seconds`;

            this._mapAccountPasswords.set(strAccountName, strPassword);

            if (this._timer.active(strAccountName)) {
                this._timer.adjust(strAccountName, strPeriod);
            } else {
                this._timer.setTimeout(strAccountName, this._clearPassword.bind(this, strAccountName), strPeriod);
            }
        }

        async importPrivateKey(strAccountName, strPrivateKey, bRescan = false) {
            assert(this._mapAccountPasswords.has(strAccountName), 'unlockAccount first');
            await this._ensureAccount(strAccountName);

            const kp = Crypto.keyPairFromPrivate(strPrivateKey);

            const objEncryptedPk = await Crypto.encrypt(
                this._mapAccountPasswords.get(strAccountName),
                Buffer.from(strPrivateKey, 'hex')
            );

            await this._storage.writeKeystore(kp.address, strAccountName, objEncryptedPk);

            try {
                await this._storage.walletWatchAddress(kp.address);
                if (bRescan) await this._storage.walletReIndex();
            } catch (e) {
                logger.error(e);
            }
        }

        _clearPassword(strAccountName) {
            this._mapAccountPasswords.delete(strAccountName);
        }

        async _ensureAccount(strAccountName) {
            if (!await this._storage.hasAccount(strAccountName)) {
                await this._storage.createAccount(strAccountName);
            }
        }

        async walletListUnspent(strAddress) {
            return await this._storage.walletListUnspent(strAddress);
        }

        async getCoinHistory(strAddress) {
            return await this._storage.getCoinHistory(strAddress);
        }

        async getAccountAddresses(strAccountName) {
            return await this._storage.getAccountAddresses(strAccountName);
        }

        async countWallets() {
            return await this._storage.countWallets();
        }

        async walletWatchAddress(strAddress, bReindex) {
            await this._storage.walletWatchAddress(strAddress);
            if (bReindex) await this._storage.walletReIndex();
        }

        async getWalletsAddresses() {
            return this._storage.getWalletsAddresses();
        }

        /**
         * Create TX with funds transfer. Change generated
         *
         * @param objParameters.strAccountName
         * @param objParameters.strAddressTo
         * @param objParameters.nAmount
         * @param objParameters.strChangeAddress
         * @param objParameters.nConciliumId
         * @return {Promise<Transaction>}
         */
        async sendToAddress(objParameters) {
            checkRequiredParameters(objParameters, ['strAccountName', 'strAddressTo', 'nAmount', 'strChangeAddress']);

            let {strAccountName, strAddressTo, nAmount, strChangeAddress, nConciliumId = 1} = objParameters;
            strAddressTo = stripAddressPrefix(Constants, strAddressTo);
            strChangeAddress = stripAddressPrefix(Constants, strChangeAddress);

            assert(this._mapAccountPasswords.has(strAccountName), 'unlockAccount first');

            await this._ensureAccount(strAccountName);
            const tx = new Transaction();
            tx.conciliumId = nConciliumId;

            const arrAccountAddresses = await this.getAccountAddresses(strAccountName);
            const nReqPlusOutputs = nAmount + this._nFeePerReceiver * 2;
            const [nTotalGathered, arrAddressesOwners] = await this._formTxInputs(
                tx,
                arrAccountAddresses,
                nReqPlusOutputs
            );

            const nRequired = nReqPlusOutputs + arrAddressesOwners.length * this._nFeePerInput;
            if (nTotalGathered < nRequired) {
                throw(`Not enough coins to send. Required (with fee): ${nRequired}. Have: ${nTotalGathered}`);
            }

            tx.addReceiver(nAmount, Buffer.from(stripAddressPrefix(Constants, strAddressTo), 'hex'));
            if (nTotalGathered - nRequired) {
                tx.addReceiver(nTotalGathered - nRequired,
                    Buffer.from(stripAddressPrefix(Constants, strChangeAddress), 'hex')
                );
            }

            this._claimFundsAndSignTx(
                tx,
                arrAddressesOwners,
                await this._storage.getKeystoresForAccount(strAccountName),
                this._mapAccountPasswords.get(strAccountName)
            );

            return tx;
        }

        /**
         *
         * @param objParameters
         * @return {Promise<Transaction>}
         */
        async callContract(objParameters) {
            const arrRequiredParams = [
                'strAccountName',
                'strAddressContract',
                'strMethod',
                'strJsonArguments',
                'nAmount',
                'strChangeAddress'
            ];
            checkRequiredParameters(objParameters, arrRequiredParams);

            let {
                strAccountName,
                strAddressContract,
                strMethod,
                strJsonArguments,
                nAmount,
                strChangeAddress,
                nConciliumId = 1,
                nCoinLimit = 50000,
                strSignerAddress
            } = objParameters;
            strAddressContract = stripAddressPrefix(Constants, strAddressContract);
            strChangeAddress = stripAddressPrefix(Constants, strChangeAddress);
            strSignerAddress = stripAddressPrefix(Constants, strSignerAddress);

            assert(this._mapAccountPasswords.has(strAccountName), 'unlockAccount first');
            await this._ensureAccount(strAccountName);

            const objCodeInvoke = createObjInvocationCode(strMethod, JSON.parse(strJsonArguments));
            const tx = Transaction.invokeContract(
                stripAddressPrefix(Constants, strAddressContract),
                objCodeInvoke,
                nAmount,
                stripAddressPrefix(Constants, strChangeAddress)
            );
            tx.conciliumId = nConciliumId;

            const arrAccountAddresses = await this.getAccountAddresses(strAccountName);
            if (strSignerAddress && !arrAccountAddresses.includes(strSignerAddress)) {
                throw(`Signer address specified BUT not found in account`);
            }

            const nReqPlusOutputs = nAmount + nCoinLimit +
                                    this._nFeePerReceiver + this._estimateSizeContractInvoke(objCodeInvoke);
            const [nTotalGathered, arrAddressesOwners] = await this._formTxInputs(
                tx,
                arrAccountAddresses,
                nReqPlusOutputs
            );

            const nRequired = nReqPlusOutputs + arrAddressesOwners.length * this._nFeePerInput;
            if (nTotalGathered < nRequired) {
                throw(`Not enough coins to send. Required (with fee): ${nRequired}. Have: ${nTotalGathered}`);
            }

            if (nTotalGathered - nRequired) {
                tx.addReceiver(nTotalGathered - nRequired,
                    Buffer.from(stripAddressPrefix(Constants, strChangeAddress), 'hex')
                );
            }

            this._claimFundsAndSignTx(
                tx,
                arrAddressesOwners,
                await this._storage.getKeystoresForAccount(strAccountName),
                this._mapAccountPasswords.get(strAccountName),
                strSignerAddress
            );

            return tx;
        }

        /**
         * Add claims to Tx
         *
         * @param tx
         * @param arrAddressesOwners
         * @param mapAddrKeystore -
         * @param strPassword - password to decrypt keys
         * @param strAddrToSign - address wo should sign TX (if it's contract call)
         * @return {Promise<void>}
         * @private
         */
        async _claimFundsAndSignTx(tx, arrAddressesOwners, mapAddrKeystore, strPassword, strAddrToSign) {
            const mapUnencryptedKeys = this._ensurePk(
                strPassword,
                arrAddressesOwners,
                mapAddrKeystore
            );
            for (let i = 0; i < arrAddressesOwners.length; i++) {
                const strAddress = arrAddressesOwners[i];
                const pk = mapUnencryptedKeys.get(strAddress);
                if (!pk) throw(`Private key for ${strAddress} not found`);
                tx.claim(i, pk);
            }

            const signPk = mapUnencryptedKeys.get(strAddrToSign);
            if (strAddrToSign && signPk) {
                tx.signForContract(signPk);
            }
        }

        /**
         * Return map address -> PK
         *
         * @param password
         * @param arrAddressesOwners
         * @param mapAddrKeystore
         * @return {Map<any, any>}
         * @private
         */
        _ensurePk(password, arrAddressesOwners, mapAddrKeystore) {
            const mapUnencryptedKeys = new Map();
            const setUsedAddresses = new Set(arrAddressesOwners);
            for (let strAddress of setUsedAddresses) {
                const strPrivateKey = Crypto.decrypt(password, mapAddrKeystore.get(strAddress));
                mapUnencryptedKeys.set(strAddress, strPrivateKey);
            }
            return mapUnencryptedKeys;
        }

        /**
         * Gather UTXOs & add inputs to TX
         *
         * @param tx
         * @param arrAddresses
         * @param nAmount
         * @return {Promise<*[]>}
         * @private
         */
        async _formTxInputs(tx, arrAddresses, nAmount) {
            let nTotalGathered = 0;
            let restOfAmount = nAmount;
            const arrAddressesOwners = [];
            for (let strAddress of arrAddresses) {
                const arrUtxos = await this._storage.walletListUnspent(strAddress);
                const arrResult = finePrintUtxos(arrUtxos);

                const {arrCoins, gathered, bDone} = this._gatherInputsForAmount(
                    arrResult,
                    restOfAmount + this._nFeePerInput * (arrAddressesOwners.length)
                );
                for (let objCoin of arrCoins) {
                    tx.addInput(objCoin.hash, objCoin.nOut);

                    // since we use SIG_HASH_ALL for now, we need to build TX first, and then claim coins
                    // so we'll store address that should be used for claim this input
                    arrAddressesOwners.push(strAddress);
                }
                nTotalGathered += gathered;
                restOfAmount -= gathered;

                if (bDone) break;
            }

            return [nTotalGathered, arrAddressesOwners];
        }

        /**
         *
         * @param {Array} arrObjUnspent - @see utils.finePrintUtxos
         * @param {Number} amount
         * @return {{bDone: *, arrCoins: *, gathered: *}}
         * @private
         */
        _gatherInputsForAmount(arrObjUnspent, amount) {
            const arrCoins = [];
            let gathered = 0;
            let bDone = false;

            for (let coins of arrObjUnspent) {
                if (!coins.amount) continue;
                gathered += coins.amount;
                arrCoins.push(coins);
                if (gathered > amount + this._nFeePerInput * arrCoins.length) {
                    bDone = true;
                    break;
                }
            }
            return {arrCoins, gathered, bDone};
        }

        _estimateSizeContractInvoke(objContaractInvoke) {
            const nSize = JSON.stringify(objContaractInvoke).length + 20 + 4;
            return this._nFeePerReceiver + parseInt(Constants.fees.TX_FEE * (nSize / 1024)) + 1;
        }
    };
