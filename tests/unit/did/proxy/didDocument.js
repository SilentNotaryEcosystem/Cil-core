const {DidProxy} = require('./didProxy');
const {ADDRESS_TYPE} = require('../constants');

class DidDocument extends DidProxy {
    constructor() {
        super();
    }

    getByAddress(strAddress) {
        return this.getActiveDid().get(strAddress);
    }

    get(provider, name) {
        // invoke a contract here
        return this.getActiveDid().getData(provider, name, ADDRESS_TYPE.DID_DOCUMENT);
    }
}

module.exports = {
    DidDocument
};
