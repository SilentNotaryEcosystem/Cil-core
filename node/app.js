'use strict';

const typeforce = require('typeforce');
const debugLib = require('debug');
const {sleep} = require('../utils');
const types = require('../types');

const debug = debugLib('application:');

module.exports = ({Transaction}) =>
    class Application {
        constructor(options) {
        }

        /**
         * Throws error
         *
         * @param block
         * @returns {Promise<{}>}
         */
        async processBlock(block) {
            return {};
        }
    };
