module.exports = class Payload {
    // constructor() {
    //     this.nonce = 0;
    //     this.gasLimit = 0;
    //     this.gasPrice = 0;
    //     this.to = "address";
    //     this.value = 1;
    // }

    constructor(nonce, gasLimit, gasPrice, to, value, extField) {
        this._nonce = nonce;
        this._gasLimit = gasLimit;
        this._gasPrice = gasPrice;
        this._to = to;
        this._value = value;
        this._extField = extField;
    }

    get nonce() {
        return this._nonce;
    }

    set nonce(value) {
        this._nonce = value;
    }

    get gasLimit() {
        return this._gasLimit;
    }

    set gasLimit(value) {
        this._gasLimit = value;
    }

    get gasPrice() {
        return this._gasPrice;
    }

    set gasPrice(value) {
        this._gasPrice = value;
    }

    get to() {
        return this._to;
    }

    set to(value) {
        this._to = value;
    }

    get value() {
        return this._value;
    }

    set value(value) {
        this._value = value;
    }

    get extField() {
        return this._extField;
    }

    set extField(value) {
        this._extField = value;
    }
};
