const Mutex = require('mutex');
const debugLib = require('debug');

const config = require('../config/test.conf');
const BaseFactory = require('../baseFactory');

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


const Ipv6TransportWrapper = require('../network/ipv6Transport');

class TestIpV6Factory extends BaseFactory {
    constructor(options, objConstants) {
        super(options, objConstants);
    }

    initSpecific() {
        this._transportImplemetation = Ipv6TransportWrapper(this);
    }
}

const getNewTestIpV6Factory = (constants = {}) =>
    new TestIpV6Factory(
        {
            testStorage: true,
            mutex: new Mutex(),
            workerSuspended: true
        },
        {...config.constants, ...constants}
    );

module.exports = getNewTestIpV6Factory();
module.exports.getNewTestIpV6Factory = getNewTestIpV6Factory;
