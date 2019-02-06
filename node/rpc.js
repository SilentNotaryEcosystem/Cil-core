'use strict';
const typeforce = require('typeforce');
const debugLib = require('debug');

const rpc = require('json-rpc2');

const {sleep, asyncRPC} = require('../utils');
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
            this._server = rpc.Server.$create({websocket: true});
            if (rpcUser && rpcPass) this._server.enableAuth(rpcUser, rpcPass);

            this._server.expose('sendRawTx', asyncRPC(this.sendRawTx.bind(this)));
            this._server.expose('getTxReceipt', asyncRPC(this.sendRawTx.bind(this)));
            this._server.listen(rpcPort, rpcAddress);
        }

        async sendRawTx(args) {
            const {buffTx} = args;
            typeforce(typeforce.Buffer, buffTx);

            const tx = new Transaction(buffTx);
            return await this._nodeInstance.rpcHandler({
                event: 'tx',
                content: tx
            });
        }

        async getTxReceipt(args) {
            const {strTxHash} = args;
            typeforce(types.Str64, strTxHash);

            return await this._nodeInstance.rpcHandler({
                event: 'txReceipt',
                content: strTxHash
            });
        }

        informWsSubscribers(topic, objData) {
            this._server.broadcastToWS(topic, objData);
        }
    };
