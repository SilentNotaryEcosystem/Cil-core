'use strict';
const typeforce = require('typeforce');
const debugLib = require('debug');

const rpc = require('json-rpc2');

const {asyncRPC, prepareForStringifyObject} = require('../utils');
const types = require('../types');

const debug = debugLib('RPC:');

module.exports = ({Constants, Transaction}) =>
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

            const {rpcUser, rpcPass, rpcPort = Constants.rpcPort, rpcAddress = '::1'} = options;
            this._server = rpc.Server.$create({
                websocket: true,
                headers: {
                    'Access-Control-Allow-Origin': '*'
                }
            });
            if (rpcUser && rpcPass) this._server.enableAuth(rpcUser, rpcPass);

            this._server.expose('sendRawTx', asyncRPC(this.sendRawTx.bind(this)));
            this._server.expose('getTxReceipt', asyncRPC(this.sendRawTx.bind(this)));
            this._server.expose('getBlock', asyncRPC(this.getBlock.bind(this)));
            this._server.expose('getTips', asyncRPC(this.getTips.bind(this)));
            this._server.expose('getNext', asyncRPC(this.getNext.bind(this)));
            this._server.expose('getPrev', asyncRPC(this.getPrev.bind(this)))

            this._server.listen(rpcPort, rpcAddress);
        }

        /**
         *
         * @param {Object} args
         * @param {String} args.buffTx
         * @returns {Promise<void>}
         */
        async sendRawTx(args) {
            const {buffTx} = args;
            typeforce(typeforce.Buffer, buffTx);

            const tx = new Transaction(buffTx);
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

        informWsSubscribers(topic, result) {
            this._server.broadcastToWS(topic,
                {
                    hash: result.block.getHash(),
                    block: prepareForStringifyObject(result.block),
                    state: result.state
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

            const result = await this._nodeInstance.rpcHandler({
                event: 'getBlock',
                content: strBlockHash
            });

            return result ? {
                hash: result.block.getHash(),
                block: prepareForStringifyObject(result.block),
                state: result.state
            } : undefined;
        }

        /**
         *
         * @returns {Promise<Array>} of blockInfos (headers)
         */
        async getTips() {
            const arrBlockState = await this._nodeInstance.rpcHandler({
                event: 'getTips'
            });

            return arrBlockState.map(objBlockState => ({
                hash: objBlockState.block.getHash(),
                block: prepareForStringifyObject(objBlockState.block),
                state: objBlockState.state
            }));
        }
        /**
         *
         * @returns {Promise<Array>} of blockInfos (headers)
         */
        async getNext(args) {
            const {strBlockHash} = args;
            typeforce(types.Str64, strBlockHash);

            const arrBlockState = await this._nodeInstance.rpcHandler({
                event: 'getNext',
                content: strBlockHash
            });

            return arrBlockState.map(objBlockState => ({
                hash: objBlockState.block.getHash(),
                block: prepareForStringifyObject(objBlockState.block),
                state: objBlockState.state
            }));
        }
        /**
         *
         * @returns {Promise<Array>} of blockInfos (headers)
         */
        async getPrev(args) {
            const {strBlockHash} = args;
            typeforce(types.Str64, strBlockHash);


            const arrBlockState = await this._nodeInstance.rpcHandler({
                event: 'getPrev',
                content: strBlockHash
            });
//console.log(arrBlockState)
            return arrBlockState.map(objBlockState => ({
                hash: objBlockState.block.getHash(),
                block: prepareForStringifyObject(objBlockState.block),
                state: objBlockState.state
            }));
        }
    };
