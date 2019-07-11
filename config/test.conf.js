const commonConfig = require('./prod.conf');

module.exports = {

    // some of constants will be injected from prototypes in Factory!
    constants: {

        ...commonConfig.constants,

        CONCILIUM_DEFINITION_CONTRACT_ADDRESS: undefined,
        GENESIS_BLOCK: undefined,

        strIdent: 'Test',

        port: 28223,

        // IMPORTANT for tests (or it starts failing on RPC listen)
        rpcPort: undefined,

        DNS_SEED: [],

        // how much we suppress creating empty blocks
        WITNESS_HOLDOFF: 5 * 60 * 1000,

        MEMPOOL_TX_QTY: 5,
        MEMPOOL_TX_LIFETIME: 5000,
        MEMPOOL_OUTDATED_INTERVAL: 24 * 60 * 60 * 1000,

        DB_PATH_PREFIX: './testDb',

        concilium: {
            HEIGHT_TO_RELEASE_ADD_ON: 1,
            POS_CONCILIUM_ROUNDS: 1
        }
    }
};
