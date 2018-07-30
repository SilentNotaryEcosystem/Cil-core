const Factory = require('../factory');

class WitnessNode {
    constructor(options) {

        // TODO: определиться как будем хранить приватный ключ
        const {privateKey} = options;

        if (!privateKey) throw new Error('No private key for witness node');
        this._wallet = new Factory.Wallet(privateKey);
    }
}

module.exports = WitnessNode;
