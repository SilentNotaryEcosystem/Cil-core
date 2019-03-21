const commonConfig = require('./prod.conf');

module.exports = {

    // some of constants will be injected from prototypes in Factory!
    constants: {

        ...commonConfig.constants,

        GROUP_DEFINITION_CONTRACT_ADDRESS: undefined,
        GENESIS_BLOCK: undefined,

        strIdent: 'Test',

        port: 28223,

        // IMPORTANT for tests (or it starts failing on RPC listen)
        rpcPort: undefined,

        DNS_SEED: [],

        // how much we suppress creating empty blocks

        WITNESS_HOLDOFF: 5 * 60 * 1000
    }
};
