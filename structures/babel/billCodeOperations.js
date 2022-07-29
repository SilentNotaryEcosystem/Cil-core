const babel = require("@babel/core");
const commentBilledOperations = require('./plugins/commentBilledOperations');

const billCoins = (cost, comment) =>
   `if ((__nTotalCoins -= ${cost}) <= 0) throw new Error('Contract run out of coins'); // ${comment}`;

/**
 *
 * @param {String} strCode
 * @returns {String}
 */
module.exports = (strCode) => {
    const commentedCode = babel.transform(strCode, {
        plugins: [commentBilledOperations]
    });

    const finalCode = commentedCode.code.replace(
        /\/\/ #Bill#(?<COST>\d+)#(?<COMMENT>\w+)/g,
            (all ,cost, comment) => billCoins(cost, comment)
     );

    return finalCode;
}
