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

        DEV_FOUNDATION_ADDRESS: 'f281ebab4e699608b9beccbabb39389b774f2898',
        DEV_FOUNDATION_SHARE: 0.1,

        GROUP_DEFINITION_CONTRACT_ADDRESS: 'fdcf638ac069af5830dd47c691b6ca5c214ae021',
        GENESIS_BLOCK: '2549ab8046c8a437ee4d8fe8022358d9548d8543704fc0619755f56653d081f0',

        // how much we suppress creating empty blocks

        WITNESS_HOLDOFF: 5 * 60 * 1000
    }
};
