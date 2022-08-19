class Base {
    constructor() {
        this._ownerAddress = callerAddress;
    }

    __getCode() {
        const arrFunctionsToPropagateFromBase = ['_checkOwner', '_transferOwnership', '_validateAddress'];

        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(this))
            .filter(name => name !== 'constructor' && typeof this[name] === 'function')
            .concat(arrFunctionsToPropagateFromBase);
        const objCode = {};
        methods.forEach(strFuncName => {
            const strCodeMethod = this[strFuncName].toString();

            // we prepend code of asynс function with '<'
            const codePrefix = Object.getPrototypeOf(this[strFuncName]).constructor.name === 'AsyncFunction' ? '<' : '';
            const re = new RegExp(`${strFuncName}.*?(\(.*?\).*?\{.*\})`, 'ms');
            const arrMatches = strCodeMethod.match(re);
            if (!arrMatches) throw new Error(`Bad code for ${strFuncName}`);
            objCode[strFuncName] = codePrefix + arrMatches[1];
        });
        return objCode;
    }

    _validateAddress(strAddress) {
        if (strAddress.length !== 40) throw 'Bad address';
    }

    _checkOwner() {
        if (this._ownerAddress !== callerAddress) throw 'Unauthorized call';
    }

    _transferOwnership(strNewAddress) {
        this._checkOwner();
        this._validateAddress(strNewAddress);

        this._ownerAddress = strNewAddress;
    }
}

class PublicOffer extends Base {
    constructor(text, bAutoOpen = false) {
        super();

        if (!this._ownerAddress) throw 'You should sign offer creation!';

        this._bOpen = false;
        this.setText(text, bAutoOpen);
        this._objJoinedAddrs = {};
    }

    setText(text, bAutoOpen = false) {
        this._checkOwner();

        if (!text || !text.length) return;
        if (this._text) throw "You can't change already published text!";

        this._text = text;
        this._bOpen = bAutoOpen;
    }

    open() {
        this._checkOwner();

        if (!this._text) throw 'Offer contain no text!';
        this._bOpen = true;
    }

    close() {
        this._checkOwner();

        this._bOpen = false;
    }

    join() {
        if (!this.isOpen()) throw "Can't join. Offer closed.";
        if (!callerAddress) throw 'You should sign offer.';
        if (this.wasAcceptedBy(callerAddress)) throw 'Already accepted';

        // if you need some money transfer here - you could check value
        this._objJoinedAddrs[callerAddress] = contractTx;
    }

    isOpen() {
        return this._bOpen;
    }

    wasAcceptedBy(strAddr) {
        this._validateAddress(strAddr);
        return this._objJoinedAddrs[strAddr];
    }

    getOfferText() {
        return this._text;
    }
}

module.exports = PublicOffer;
