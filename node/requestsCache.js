'use strict';

const typeforce = require('typeforce');
const debugLib = require('debug');

const types = require('../types');

const debug = debugLib('requestsCache:');

module.exports = ({Constants}) =>
    class RequestCache {
        constructor() {
            this._mapRequests = new Map();
        }

        /**
         *
         * @param {Buffer | String} hash - hash to be requested
         * @returns {boolean}
         *   true - means we should request (not requested yet, or previous request was timed out
         *   false - request is already pending
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
            const awaitTill = this._mapRequests.get(hash);
            return awaitTill && awaitTill > Date.now();
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

        isEmpty() {
            this._purgeOutdated();
            return this._mapRequests.size === 0;
        }

        _purgeOutdated() {
            for (let hash of this._mapRequests.keys()) {
                const awaitTill = this._mapRequests.get(hash);
                if (!awaitTill || awaitTill < Date.now()) this._mapRequests.delete(hash);
            }
        }
    };
