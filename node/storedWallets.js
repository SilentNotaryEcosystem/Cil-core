'use strict';
const assert = require('assert');
const Tick = require('tick-tock');

module.exports = (Crypto =>
        class StoredWallet {
            constructor(props) {
                const {storage} = props;
                assert(storage, 'StoredWallet constructor requires Storage instance!');

                this._storage = storage;
                this._mapAccountPasswords = new Map();
                this._timer = new Tick();
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

                await this._storage.writeKeyStore(kp.address, strAccountName, objEncryptedPk);
                await this._storage.walletWatchAddress(kp.address);

                if (bRescan) await this._storage.walletReIndex();
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
        }
);
