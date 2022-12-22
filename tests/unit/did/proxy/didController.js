const {DidProxy} = require('./didProxy');
const {PROVIDER} = require('../constants');

class DidController extends DidProxy {
    constructor() {
        super();
        this._providers = PROVIDER.values();
    }

    create(objDidDocument) {
        this.getActiveDid().create(objDidDocument);
    }

    replace(strAddress, objNewDidDocument) {
        this.getActiveDid().replace(strAddress, objNewDidDocument);
    }

    remove(strAddress) {
        this.getActiveDid().remove(strAddress);
    }
}

module.exports = {
    DidController
};
