'use strict';

/**
 * Should inject smart contract billing code
 * @param {String} strCode - original smart contract code
 * @param {String} strTotalCoinsHash - hash suffix for __nTotalCoins_ varriable
 * @param {Number|undefined} nContractBillingVersion - billing api version to use
 * @returns {String}
 * @throws An unsupported operation error in case if strCode contains any dangerous operation
 */
module.exports = (strCode, strTotalCoinsHash, nContractBillingVersion = undefined) => {
    if (!nContractBillingVersion) return strCode;

    return require(`./v${nContractBillingVersion}/babel/billCodeOperations`)(strCode, strTotalCoinsHash);
};
