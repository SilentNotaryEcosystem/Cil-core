'use strict';
const EventEmitter = require('events');
const typeforce = require('typeforce');
const debugLib = require('debug');
const {sleep} = require('../utils');
const types = require('../types');

const debug = debugLib('RPC:');

module.exports = ({Transaction}) =>
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

            // TODO: register endpoint
        }

        sendRawTx(bufTx) {
            typeforce('Buffer', bufTx);

            try {
                const tx = new Transaction(bufTx);
                this.emit('rpc', {
                    event: 'tx',
                    content: tx
                });
            } catch (e) {
                logger.error('RPC: bad tx received');
            }
        }
    };
