const Mutex = require('mutex');
const BaseFactory = require('../baseFactory');
const config = require('../config/test.conf');

global.logger = console;
global.logger.debug = console.log;
global.logger.error = console.error;

/**
 * Class to easy replacement used components
 */

const TransportWrapper = require('../network/testTransport');

class TestFactory extends BaseFactory {
    constructor(options, objConstants) {
        super(options, objConstants);
    }

    initSpecific() {
        this._transportImplemetation = TransportWrapper(this);
    }
}

const getNewTestFactory = (constants = {}) =>
    new TestFactory(
        {
            testStorage: true,
            mutex: new Mutex(),
            workerSuspended: true,
            bDev: true
        },
        {...config.constants, ...constants}
    );

module.exports = getNewTestFactory();
module.exports.getNewTestFactory = getNewTestFactory;
