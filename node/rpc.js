'use strict';
const typeforce = require('typeforce');
const assert = require('assert');
const debugLib = require('debug');

const rpc = require('json-rpc2');

const {asyncRPC, prepareForStringifyObject, stripAddressPrefix} = require('../utils');
const types = require('../types');

const debug = debugLib('RPC:');

module.exports = ({Constants, Transaction, StoredWallet, UTXO}) =>
    class RPC {
        /**
         *
         * @param {Node} cNodeInstance - to make requests to node
         * @param {Object} options
         * @param {String} options.addr - listen addr
         * @param {Number} options.port - listen port
         * @param {String} options.token - auth token
         */
        constructor(cNodeInstance, options) {
            this._nodeInstance = cNodeInstance;
            this._storedWallets = new StoredWallet({storage: cNodeInstance.storage});

            const {rpcUser, rpcPass, rpcPort = Constants.rpcPort, rpcAddress = '::1'} = options;
            this._server = rpc.Server.$create({
                websocket: true,
                headers: {
                    'Access-Control-Allow-Origin': '*'
                },

                // default rate limit: 20 requests/second
                ratelimit: {maxPerInterval: 20, msInterval: 1000},

                // this allow override defaults above
                ...options
            });
            if (rpcUser && rpcPass) this._server.enableAuth(rpcUser, rpcPass);

            this._server.expose('sendRawTx', asyncRPC(this.sendRawTx.bind(this)));
            this._server.expose('getTxReceipt', asyncRPC(this.getTxReceipt.bind(this)));
            this._server.expose('getBlock', asyncRPC(this.getBlock.bind(this)));
            this._server.expose('getTips', asyncRPC(this.getTips.bind(this)));
            this._server.expose('getNext', asyncRPC(this.getNext.bind(this)));
            this._server.expose('getPrev', asyncRPC(this.getPrev.bind(this)));
            this._server.expose('getTx', asyncRPC(this.getTx.bind(this)));
            this._server.expose('constantMethodCall', asyncRPC(this.constantMethodCall.bind(this)));
            this._server.expose('getContractData', asyncRPC(this.getContractData.bind(this)));
            this._server.expose('getUnspent', asyncRPC(this.getUnspent.bind(this)));

            this._server.expose('walletListUnspent', asyncRPC(this.walletListUnspent.bind(this)));
            this._server.expose('accountListUnspent', asyncRPC(this.getAccountUnspent.bind(this)));
            this._server.expose('getBalance', asyncRPC(this.getBalance.bind(this)));
            this._server.expose('getAccountBalance', asyncRPC(this.getAccountBalance.bind(this)));

            this._server.expose('watchAddress', asyncRPC(this.watchAddress.bind(this)));
            this._server.expose('getWalletsAddresses', asyncRPC(this.getWalletsAddresses.bind(this)));
            this._server.expose('getWitnesses', asyncRPC(this.getWitnesses.bind(this)));
            this._server.expose('countWallets', asyncRPC(this.countWallets.bind(this)));
            this._server.expose('getLastBlockByConciliumId', asyncRPC(this.getLastBlockByConciliumId.bind(this)));

            this._server.expose('unlockAccount', asyncRPC(this.unlockAccount.bind(this)));
            this._server.expose('importPrivateKey', asyncRPC(this.importPrivateKey.bind(this)));
            this._server.expose('getNewAddress', asyncRPC(this.getNewAddress.bind(this)));
            this._server.listen(rpcPort, rpcAddress);
        }

        /**
         *
         * @param {Object} args
         * @param {String} args.buffTx
         * @returns {Promise<void>}
         */
        async sendRawTx(args) {
            const {strTx} = args;
            typeforce(typeforce.String, strTx);

            const tx = new Transaction(Buffer.from(strTx, 'hex'));
            return await this._nodeInstance.rpcHandler({
                event: 'tx',
                content: tx
            });
        }

        /**
         *
         * @param {Object} args
         * @param {String} args.strTxHash
         * @returns {Promise<TxReceipt>}
         */
        async getTxReceipt(args) {
            const {strTxHash} = args;
            typeforce(types.Str64, strTxHash);

            const cReceipt = await this._nodeInstance.rpcHandler({
                event: 'txReceipt',
                content: strTxHash
            });
            return prepareForStringifyObject(cReceipt ? cReceipt.toObject() : undefined);
        }

        informWsSubscribersNewBlock(result) {
            this._server.broadcastToWS('newBlock',
                {
                    hash: result.block.getHash(),
                    block: prepareForStringifyObject(result.block.toObject()),
                    state: result.state
                }
            );
        }

        informWsSubscribersStableBlocks(arrHashes) {
            this._server.broadcastToWS('stableBlocks',
                {
                    arrHashes
                }
            );
        }

        /**
         *
         * @param {Object} args
         * @param {String} args.strBlockHash
         * @returns {Promise<Block>}
         */
        async getBlock(args) {
            const {strBlockHash} = args;
            typeforce(types.Str64, strBlockHash);

            let result;
            try {
                result = await this._nodeInstance.rpcHandler({
                    event: 'getBlock',
                    content: strBlockHash
                });
                return result ? {
                    hash: result.block.getHash(),
                    block: prepareForStringifyObject(result.block.toObject()),
                    state: result.state
                } : undefined;
            } catch (err) {
                return undefined;
            }
        }

        /**
         *
         * @returns {Promise<Array>} of blockInfos (headers)
         */
        async getTips() {
            let arrBlockState;
            try {
                arrBlockState = await this._nodeInstance.rpcHandler({
                    event: 'getTips'
                });

                return arrBlockState.map(objBlockState => ({
                    hash: objBlockState.block.getHash(),
                    block: prepareForStringifyObject(objBlockState.block.toObject()),
                    state: objBlockState.state
                }));
            } catch (err) {
                return [];
            }
        }

        /**
         *
         * @returns {Promise<Array>} of blockInfos (headers)
         */
        async getNext(args) {
            const {strBlockHash} = args;
            typeforce(types.Str64, strBlockHash);

            let arrBlockState;
            try {
                arrBlockState = await this._nodeInstance.rpcHandler({
                    event: 'getNext',
                    content: strBlockHash
                });
                return arrBlockState.map(objBlockState => ({
                    hash: objBlockState.block.getHash(),
                    block: prepareForStringifyObject(objBlockState.block.toObject()),
                    state: objBlockState.state
                }));
            } catch (err) {
                return [];
            }
        }

        /**
         *
         * @returns {Promise<Array>} of blockInfos (headers)
         */
        async getPrev(args) {
            const {strBlockHash} = args;
            typeforce(types.Str64, strBlockHash);

            let arrBlockState;
            try {
                arrBlockState = await this._nodeInstance.rpcHandler({
                    event: 'getPrev',
                    content: strBlockHash
                });
                return arrBlockState.map(objBlockState => ({
                    hash: objBlockState.block.getHash(),
                    block: prepareForStringifyObject(objBlockState.block.toObject()),
                    state: objBlockState.state
                }));
            } catch (err) {
                return [];
            }
        }

        async getTx(args) {
            const {strTxHash} = args;

            const objTx = await this._nodeInstance.rpcHandler({
                event: 'getTx',
                content: strTxHash
            });

            return prepareForStringifyObject(objTx);
        }

        async constantMethodCall(args) {
            const objResult = await this._nodeInstance.rpcHandler({
                event: 'constantMethodCall',
                content: args
            });

            return prepareForStringifyObject(objResult);
        }

        /**
         * Get one UTXO by hash
         *
         * @param {Object} args
         * @return {Promise<{}|*>}
         */
        async getUnspent(args) {
            const {strTxHash} = args;

            const objResult = await this._nodeInstance.rpcHandler({
                event: 'getUnspent',
                content: strTxHash
            });

            return prepareForStringifyObject(objResult);
        }

        async walletListUnspent(args) {
            let {strAddress, bStableOnly} = args;
            strAddress = stripAddressPrefix(Constants, strAddress);

            const arrStableUtxos = await this._storedWallets.walletListUnspent(strAddress);
            const arrPendingUtxos = bStableOnly ? []
                : this._nodeInstance
                    .getPendingUtxos()
                    .map(utxo => utxo.filterOutputsForAddress(strAddress));

            return prepareForStringifyObject([].concat(
                this._finePrintUtxos(arrStableUtxos, true),
                this._finePrintUtxos(arrPendingUtxos, false)
            ));
        }

        async getBalance(args) {
            const arrResult = await this.walletListUnspent(args);

            return arrResult.reduce((accum, {amount, isStable}) => {
                isStable ? accum.confirmedBalance += amount : accum.unconfirmedBalance += amount;
                return accum;
            }, {confirmedBalance: 0, unconfirmedBalance: 0});
        }

        async watchAddress(args) {
            let {strAddress, bReindex} = args;
            strAddress = stripAddressPrefix(Constants, strAddress);
            await this._storedWallets.walletWatchAddress(strAddress, bReindex);
        }

        async getWalletsAddresses() {
            return await this._storedWallets.getWalletsAddresses();
        }

        async getContractData(args) {
            let {strAddress} = args;
            strAddress = stripAddressPrefix(Constants, strAddress);
            const objData = await this._nodeInstance.rpcHandler({
                event: 'getContractData',
                content: strAddress
            });

            return prepareForStringifyObject(objData);
        }

        async getWitnesses() {
            const arrWitnessPeers = await this._nodeInstance.rpcHandler({
                event: 'getWitnesses'
            });

            const objResult = {};
            arrWitnessPeers.forEach(
                peer => objResult[peer.witnessAddress] = {
                    address: peer.address,
                    version: peer.version ? peer.version.toString(16) : undefined
                });
            return objResult;
        }

        async countWallets() {
            return prepareForStringifyObject({count: await this._storedWallets.countWallets()});
        }

        async getLastBlockByConciliumId(args) {
            const {nConciliumId} = args;

            const strHash = await this._nodeInstance.rpcHandler({
                event: 'getLastBlockByConciliumId',
                content: nConciliumId
            });
            return strHash;
        }

        async unlockAccount(args) {
            const {strAccountName, strPassword, nSeconds} = args;
            await this._storedWallets.unlockAccount(strAccountName, strPassword, nSeconds);
        }

        async importPrivateKey(args) {
            const {strAccountName, strPrivateKey, bRescan} = args;
            await this._storedWallets.importPrivateKey(strAccountName, strPrivateKey, bRescan);
        }

        async getNewAddress() {
            const kp = await this._storedWallets.getNewAddress();
            return {address: kp.address, privateKey: kp.privateKey};
        }

        async getAccountBalance(args) {
            const arrResult = await this.getAccountUnspent(args);

            return arrResult.reduce((accum, {amount, isStable}) => {
                isStable ? accum.confirmedBalance += amount : accum.unconfirmedBalance += amount;
                return accum;
            }, {confirmedBalance: 0, unconfirmedBalance: 0});
        }

        async getAccountUnspent(args) {
            const {strAccountName, bStableOnly, strHashSince} = args;

            const arrAccountAddresses = await this._storedWallets.getAccountAddresses(strAccountName);
            assert(Array.isArray(arrAccountAddresses), 'Accound doesn\'t exist');

            let arrOfArrayOfStableUtxos = [];
            for (let strAddress of arrAccountAddresses) {
                arrOfArrayOfStableUtxos.push(await this._storedWallets.walletListUnspent(strAddress));
            }

            // flatten results
            arrOfArrayOfStableUtxos = [].concat.apply([], arrOfArrayOfStableUtxos);

            const storage = this._nodeInstance.storage;
            if (strHashSince) {
                const arrFilteredArrayOfStableUtxos = [];
                for (let utxo of arrOfArrayOfStableUtxos) {
                    const buffSourceTx = await storage.findInternalTx(utxo.getTxHash()) ||
                                         Buffer.from(utxo.getTxHash(), 'hex');
                    const strBlockHash = (await storage.getTxBlock(buffSourceTx)).toString('hex');
                    if (this._nodeInstance.sortBlocks(strBlockHash, strHashSince) > 0) {
                        arrFilteredArrayOfStableUtxos.push(utxo);
                    }
                }
                arrOfArrayOfStableUtxos = arrFilteredArrayOfStableUtxos;
            }

            let arrPendingUtxos = [];
            const arrOfArrayOfPendingUtxos = [];

            if (!bStableOnly) {
                arrPendingUtxos = this._nodeInstance.getPendingUtxos();
                for (let strAddress of arrAccountAddresses) {
                    const arrFilteredUtxos = [];
                    for (let utxo of arrPendingUtxos) {
                        arrFilteredUtxos.push(utxo.filterOutputsForAddress(strAddress));
                    }
                    arrOfArrayOfPendingUtxos.push(arrFilteredUtxos);
                }
            }

            // flatten results
            return prepareForStringifyObject(
                [].concat(
                    this._finePrintUtxos(arrOfArrayOfStableUtxos, true),
                    this._finePrintUtxos([].concat.apply([], arrOfArrayOfPendingUtxos), false)
                ));
        }

        /**
         * Will return new UTXOs containing only outputs for strAddress
         *
         * @param arrUtxos
         * @param strAddress
         * @return {[]}
         * @private
         */
        _filterUtxoForAddress(arrUtxos, strAddress) {
            const arrFilteredUtxos = [];
            for (let utxo of arrUtxos) {
                const arrAddrOutputs = utxo.getOutputsForAddress(strAddress);
                if (arrAddrOutputs.length) {
                    const utxoFiltered = new UTXO({txHash: utxo.getTxHash()});
                    arrAddrOutputs.forEach(([idx, coins]) => {
                        utxoFiltered.addCoins(idx, coins);
                    });
                    arrFilteredUtxos.push(utxoFiltered);
                }
            }
            return arrFilteredUtxos;
        }

        _finePrintUtxos(arrUtxos, isStable) {
            const arrResult = [];
            arrUtxos.forEach(utxo => {
                utxo.getIndexes()
                    .map(idx => [idx, utxo.coinsAtIndex(idx)])
                    .map(([idx, coins]) => {
                        arrResult.push({hash: utxo.getTxHash(), nOut: idx, amount: coins.getAmount(), isStable});
                    });
            });

            return arrResult;
        };
    };
