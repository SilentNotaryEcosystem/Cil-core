const debugLib = require('debug');

const configProd = require('./config/prod.conf');
const configDev = require('./config/devel.conf');
const BaseFactory = require('./baseFactory');

const bDev = process.env.NODE_ENV === 'Devel'
const config = bDev ? configDev : configProd;

/**
 * Class to easy replacement used components
 */


const Ipv6TransportWrapper = require('./network/ipv6Transport');

class ProdFactory extends BaseFactory {
    constructor(options, objConstants) {
        super(options, objConstants);
    }

    initSpecific() {
        this._transportImplemetation = Ipv6TransportWrapper(this);
    }
}

module.exports = new ProdFactory({bDev}, config.constants);
