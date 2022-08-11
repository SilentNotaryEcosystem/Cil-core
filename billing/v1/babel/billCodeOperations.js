'use strict';

const babel = require("@babel/core");
const bracketizeCode = require('./plugins/bracketizeCode');
const commentBilledOperations = require('./plugins/commentBilledOperations');
const hasUnsupportedOperation = require('./hasUnsupportedOperation');
const {UnsupportedException} = require('./../../../utils');

const billCoins = (cost, comment) =>
   `if (__nTotalCoins >= ${cost}) { __nTotalCoins -= ${cost}; } else throw new Error('Contract run out of coins#' + __nTotalCoins); // ${comment}`;

/**
 * Should inject smart contract billing code for v1
 * @param {String} strCode - original smart contract code
 * @returns {String}
 * @throws An unsupported operation error in case if strCode contains any dangerous operation
 */
 module.exports = (strCode) => {
    if (hasUnsupportedOperation(strCode)) {
        throw new UnsupportedException('Found unsupported operation in the contract!');
    }

    const bracketizedCode = babel.transform(strCode, {
        plugins: [bracketizeCode]
    });

    const commentedCode = babel.transform(bracketizedCode.code, {
        plugins: [commentBilledOperations]
    });

    const finalCode = commentedCode.code.replace(
        /\/\/ #BILL#(?<COST>\d+)#(?<COMMENT>\w+)/g,
            (all, cost, comment) => billCoins(cost, comment)
     );

    return finalCode;
}
