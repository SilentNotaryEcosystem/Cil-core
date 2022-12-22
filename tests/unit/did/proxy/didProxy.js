const {Base} = require('../uns');

const NO_ACTIVE_DID = 'There is no acitve DID!';

class DidProxy extends Base {
    constructor() {
        super();
        this._createFee = 1e10;
        this._didContracts = []; // latest proxy contract is the actual
        this._activeDid = null; // in real contract, a contract address for invokeContract
    }

    add(objDidContract) {
        this._activeDid = objDidContract;
        this._didContracts.push({date: new Date(), objDidContract});
    }

    getActiveDid() {
        if (!this._activeDid) throw new Error(NO_ACTIVE_DID);
        return this._activeDid;
    }

    // getDidDocuments() {
    //     if (!this._activeDid) throw new Error(NO_ACTIVE_DID);
    //     return this._activeDid.getDidDocuments();
    // }
}

module.exports = {
    DidProxy
};
