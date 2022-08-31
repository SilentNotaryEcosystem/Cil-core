'use strict';

const babel = require('@babel/core');
const bracketizeCode = require('./plugins/bracketizeCode');
const commentBilledOperations = require('./plugins/commentBilledOperations');
const hasUnsupportedOperation = require('./hasUnsupportedOperation');
const {UnsupportedException} = require('./../../../utils');

const billCoins = (strTotalCoinsHash, cost, comment) =>
    `if (__nTotalCoins_${strTotalCoinsHash} >= ${cost}) { __nTotalCoins_${strTotalCoinsHash} -= ${cost}; } else throw new Error('Contract run out of coins#' + __nTotalCoins_${strTotalCoinsHash}); // ${comment}`;

/**
 * Should inject smart contract billing code for v1
 * @param {String} strCode - original smart contract code
 * @param {String} strTotalCoinsHash - hash suffix for __nTotalCoins_ varriable
 * @returns {String}
 * @throws An unsupported operation error in case if strCode contains any dangerous operation
 */
module.exports = (strCode, strTotalCoinsHash) => {
    if (hasUnsupportedOperation(strCode)) {
        throw new UnsupportedException('Found unsupported operation in the contract!');
    }

    const bracketizedCode = babel.transform(strCode, {
        plugins: [bracketizeCode]
    });

    const commentedCode = babel.transform(bracketizedCode.code, {
        plugins: [commentBilledOperations]
    });

    const finalCode = commentedCode.code.replace(/\/\/ #BILL#(?<COST>\d+)#(?<COMMENT>\w+)/g, (all, cost, comment) =>
        billCoins(strTotalCoinsHash, cost, comment)
    );

    return finalCode;
};
