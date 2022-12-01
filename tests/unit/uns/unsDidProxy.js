const {Base} = require('./uns');
const {ADDRESS_TYPE} = require('./constants');

class UnsDidProxy extends Base {
    constructor() {
        super();
        this._createFee = 1e10;
        this._unsList = []; // latest proxy contract is the actual
        this._activeUns = null; // in real contract, a contract address for invokeContract
    }

    addUns(uns) {
        this._activeUns = uns;
        this._unsList.push({date: new Date(), uns});
    }

    _add(provider, name, address) {
        const resolver = this._activeUns.getUnsProviderResolver(provider);
        resolver.add(name, address);
    }

    _get(provider, name, addresType = ADDRESS_TYPE.DEFAULT) {
        const resolver = this._activeUns.getUnsProviderResolver(provider);
        resolver.get(name, addresType);
    }

    // getUnsProviderResolver(provider) {
    //     return new (getUnsProviderResolver(provider, this))();
    // }

    //     get(provider, name, useDIdFormat = false) {}
    //     add(provider, name, address) {}
    //     update(provider, name, address) {}
    //     remove(provider, name) {}
    //     // запуск этой штуки за миллион
}

module.exports = {
    UnsDidProxy
};
