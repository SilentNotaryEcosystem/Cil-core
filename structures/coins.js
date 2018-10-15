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

        static createFromData({amount, codeClaim}) {
            return new this(amount, codeClaim);
        }

        getAmount() {
            return this._data.amount;
        }

        getCodeClaim() {
            return this._data.codeClaim;
        }

        getRawData() {
            return this._data;
        }

        /**
         *
         * @param {Coins} coin
         * @returns {boolean|*}
         */
        equals(coin) {
            return this.getAmount() === coin.getAmount() && this.getCodeClaim().equals(coin.getCodeClaim());
        }
    };
