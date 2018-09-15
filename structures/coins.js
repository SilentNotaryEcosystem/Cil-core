const typeforce = require('typeforce');
const types = require('../types');

module.exports = () =>
    class Coins {
        constructor(amount, codeClaim) {
            typeforce(typeforce.tuple(types.Amount, 'Buffer'), arguments);

            this._data = {
                amount,
                codeClaim
            };
        }

        getAmount() {
            return this._data.amount;
        }

        getCodeClaim() {
            return this._data.codeClaim;
        }

    };
