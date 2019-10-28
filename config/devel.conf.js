const commonConfig = require('./prod.conf');

module.exports = {

    // some of constants will be injected from prototypes in Factory!
    constants: {

        ...commonConfig.constants,

        // fees
        fees: {

            // money send fee per Kbyte
            TX_FEE: 4000,

            // contract creation
            CONTRACT_CREATION_FEE: 1e4,

            // contract invocation
            CONTRACT_INVOCATION_FEE: 1e4,

            // contract send moneys
            INTERNAL_TX_FEE: 300,

            STORAGE_PER_BYTE_FEE: 10
        },

        strIdent: 'Devel',

        protocolVersion: 0x0130,
        network: 0x12880004,
        port: 18223,
        rpcPort: 18222,

        DNS_SEED: ['dev-seed.silentnotary.io'],

        DEV_FOUNDATION_ADDRESS: '087b7b06bfc8f198eb25655c358355692187f9d1',
        CONCILIUM_DEFINITION_CONTRACT_ADDRESS: 'a46b92916bc8db1d4b403198f557b987b88f5ae2',
        GENESIS_BLOCK: '2bf44e4c0602b8b3c9184fd78bb44b049cfb483727c765638ec0b08afaec3509',

        // how much we suppress creating empty blocks

        WITNESS_HOLDOFF: 1 * 60 * 1000,

        INV_REQUEST_HOLDOFF: 5 * 60 * 1000,

        concilium: {
            HEIGHT_TO_RELEASE_ADD_ON: 50,
            POS_CONCILIUM_ROUNDS: 10
        },

        forks: {
            HEIGHT_FORK_SERIALIZER: 8970,
            HEIGHT_FORK_CHANGE: 8992,
            HEIGHT_FORK_SERIALIZER_FIX2: 12405
        }
    }
};
