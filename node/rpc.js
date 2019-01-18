'use strict';
const EventEmitter = require('events');
const typeforce = require('typeforce');
const debugLib = require('debug');

const rpc = require('json-rpc2');

const {sleep, asyncRPC} = require('../utils');
const types = require('../types');

const debug = debugLib('RPC:');

module.exports = ({Constants, Transaction}) =>
    class RPC extends EventEmitter {
        /**
         *
         * @param {Object} options
         * @param {String} options.addr - listen addr
         * @param {Number} options.port - listen port
         * @param {String} options.token - auth token
         */
        constructor(options) {
            super();

            const {rpcUser, rpcPass, rpcPort = Constants.rpcPort, rpcAddress = '::1'} = options;
            this._server = rpc.Server.$create({websocket: false});
            this._server.enableAuth(rpcUser, rpcPass);

            this._server.expose('sendRawTx', asyncRPC(this.sendRawTx.bind(this)));
            this._server.expose('getTxReceipt', asyncRPC(this.sendRawTx.bind(this)));
            this._server.listen(rpcPort, rpcAddress);
        }

        sendRawTx(args) {
            const {buffTx} = args;
            typeforce(typeforce.Buffer, buffTx);

            const tx = new Transaction(buffTx);
            this.emit('rpc', {
                event: 'tx',
                content: tx
            });
        }

        getTxReceipt(args) {
            const {strTxHash} = args;
            typeforce(types.Str64, strTxHash);

            this.emit('rpc', {
                event: 'txReceipt',
                content: strTxHash
            });
        }
    };
