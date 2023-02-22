const commonConfig = require('./prod.conf');

module.exports = {

    // some of constants will be injected from prototypes in Factory!
    constants: {

        ...commonConfig.constants,

        MEMPOOL_REANNOUNCE_INTERVAL: 5 * 1000,

        CONCILIUM_DEFINITION_CONTRACT_ADDRESS: undefined,
        GENESIS_BLOCK: undefined,

        strIdent: 'Test',

        port: 28223,

        // IMPORTANT for tests (or it starts failing on RPC listen)
        rpcPort: undefined,

        DNS_SEED: [],

        // how much we suppress creating empty blocks
        WITNESS_HOLDOFF: 5 * 60 * 1000,

        DB_PATH_PREFIX: './testDb',

        concilium: {
            HEIGHT_TO_RELEASE_ADD_ON: 1,
            POS_CONCILIUM_ROUNDS: 2
        },

        fees: {

            // money send fee per Kbyte
            TX_FEE: 4000,

            // contract creation
            CONTRACT_CREATION_FEE: 1e6,

            // contract invocation
            CONTRACT_INVOCATION_FEE: 10000,

            // contract send moneys
            INTERNAL_TX_FEE: 300,

            STORAGE_PER_BYTE_FEE: 10
        },
        TIMEOUT_CODE: 100000
    }
};
