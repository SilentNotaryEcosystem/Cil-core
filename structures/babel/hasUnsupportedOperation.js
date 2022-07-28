const babel = require("@babel/core");
const checkDangerousCode = require('./plugins/checkDangerousCode');

/**
 *
 * @param {String} strCode
 * @returns {boolean}
 */
module.exports = (strCode) => {
    let hasUnsupportedOperation = false;
    const setHasUnsupportedOperation = (value) => { hasUnsupportedOperation = value };

    babel.transform(strCode, {
        plugins: [[checkDangerousCode, { setHasUnsupportedOperation }]]
    });

    return hasUnsupportedOperation;
}
