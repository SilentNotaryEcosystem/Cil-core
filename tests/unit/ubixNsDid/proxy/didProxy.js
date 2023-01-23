const {Base, DidV1Test1} = require('../didV1');

const NO_ACTIVE_UBIX_NS = 'There is no acitve Ubix NS!';

// тут вызов по адресу контракта должен быть, его нельзя включать

class DidProxy extends Base {
    constructor() {
        super();
        this._createFee = 1e10;
        this._didList = []; // latest proxy contract address!!! is the actual
        this._activeDid = null; // in real contract, a contract address for invokeContract
    }

    add(objDid) {
        this._activeDid = objDid;
        this._didList.push({date: new Date(), objDid});
    }

    get(strProvider, strName) {
        return this._activeDid.get(DidV1Test1.crateHash(strProvider, strName));
    }
}

module.exports = {
    DidProxy
};
