const commonConfig = require('./prod.conf');

module.exports = {

    // some of constants will be injected from prototypes in Factory!
    constants: {

        ...commonConfig.constants,

        strIdent: 'Devel',

        network: 0x12880004,
        port: 18223,
        rpcPort: 18222,

        // how much we suppress creating empty blocks

        WITNESS_HOLDOFF: 5 * 60 * 1000
    }
};
