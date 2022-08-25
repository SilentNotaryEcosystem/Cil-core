'use strict';

const babel = require('@babel/core');
const checkDangerousCode = require('./plugins/checkDangerousCode');

/**
 * Whether contract has unsupported code or not
 * @param {String} strCode - original smart contract code
 * @returns {boolean}
 */
module.exports = strCode => {
    let hasUnsupportedOperation = false;
    const setHasUnsupportedOperation = value => {
        hasUnsupportedOperation = value;
    };

    babel.transform(strCode, {
        plugins: [[checkDangerousCode, {setHasUnsupportedOperation}]]
    });

    return hasUnsupportedOperation;
};
