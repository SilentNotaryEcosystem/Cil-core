const debugLib = require('debug');

const configProd = require('./config/prod.conf');
const configDev = require('./config/devel.conf');
const BaseFactory = require('./baseFactory');

const config = process.env.NODE_ENV === 'Devel' ? configDev : configProd;

// Uncomment in prod!!
const error = console.error;
const log = console.log;
const info = console.info;
info.log = console.info.bind(console);

const debug = debugLib('node:app');
debug.log = console.log.bind(console);

// simple logger
global.logger = {
    error: (...msgs) => error(msgs),
    log: (...msgs) => log(msgs),
    info: (...msgs) => info(msgs),
    debug: (...msgs) => debug(msgs)
};

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

module.exports = new ProdFactory({}, config.constants);
