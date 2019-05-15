const commonConfig = require('./prod.conf');

module.exports = {

    // some of constants will be injected from prototypes in Factory!
    constants: {

        ...commonConfig.constants,

        strIdent: 'Devel',

        network: 0x12880004,
        port: 18223,
        rpcPort: 18222,

        DNS_SEED: ['dev-seed.silentnotary.io'],

        DEV_FOUNDATION_ADDRESS: '7db2f263e789036128d3a76061258044f5112435',
        GROUP_DEFINITION_CONTRACT_ADDRESS: '16444c2b8be38ff1bc3745a9ccde75334902fa0a',
        GENESIS_BLOCK: '86a272cfe06515e09dd6adc7052416b11ce2886e827527b877c6def65c94e284',

        // how much we suppress creating empty blocks

        WITNESS_HOLDOFF: 5 * 60 * 1000
    }
};
