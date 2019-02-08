'use strict';

const typeforce = require('typeforce');
const debugLib = require('debug');

const types = require('../types');

const debug = debugLib('requestsCache:');

module.exports = ({Constants}) =>
    class MainDag {
        constructor() {
            this._mapRequests = new Map();
        }

        /**
         *
         * @param {Buffer | String} hash - hash to be requested
         * @returns {boolean}
         *   true - means we should request (not requested yet, or previous request was timed out
         *   false - request is pending
         */
        request(hash) {
            typeforce(types.Hash256bit, hash);

            hash = Buffer.isBuffer(hash) ? hash.toString('hex') : hash;
            if (this._mapRequests.has(hash) && this._mapRequests.get(hash) > Date.now()) return false;

            this._mapRequests.set(hash, Date.now() + Constants.INV_REQUEST_HOLDOFF);
            return true;
        }

        isRequested(hash) {
            typeforce(types.Hash256bit, hash);

            hash = Buffer.isBuffer(hash) ? hash.toString('hex') : hash;
            return this._mapRequests.has(hash);
        }

        /**
         *
         * @param {Buffer | String} hash - hash successfully requested
         */
        done(hash) {
            typeforce(types.Hash256bit, hash);

            hash = Buffer.isBuffer(hash) ? hash.toString('hex') : hash;
            this._mapRequests.delete(hash);
        }

    };
