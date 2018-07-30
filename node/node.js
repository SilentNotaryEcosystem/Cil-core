const Factory = require('../factory');

class Node {
    constructor(options) {
        const {witness, privateKey} = options;
        this._network = new Factory.Network(options);

        if (witness) {
            this.witness = new Factory.WitnessNode({network: this._network, ...options});
        }
    }

}

module.exports = Node;
