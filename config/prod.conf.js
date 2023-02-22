module.exports = {

    // some of constants will be injected from prototypes in Factory!
    constants: {
        LOCAL_TX_FILE_NAME: 'txns.json',

        ADDRESS_PREFIX: 'Ux',

        DEV_FOUNDATION_ADDRESS: '961d7815df8cc96d27aa2c483f55c6c163682775',
        DEV_FOUNDATION_SHARE: 0.1,

        CONCILIUM_DEFINITION_CONTRACT_ADDRESS: '6ab4ab8161f954be88af699435f3514485ab8f9a',
        GENESIS_BLOCK: '8b6d259ee3ee1acd524654d9b27286188c982e3764f1ef3f6db98c6382e6d777',

        strIdent: 'Prod',

        network: 0x12882304,
        protocolVersion: 0x0130,
        port: 8223,

        rpcPort: 8222,

        DNS_SEED: ['seed.silentnotary.io'],

        // How many peers we'll send in one 'addr' message
        ADDR_MAX_LENGTH: 1000,

        // maximum connected peers
        MAX_PEERS: 10,

        // minimum connected peers
        MIN_PEERS: 6,

        // milliseconds
        PEER_QUERY_TIMEOUT: 30000,
        CONNECTION_TIMEOUT: 60000,

        // 1 day
        BAN_PEER_SCORE: 100,
        BAN_PEER_TIME: 24 * 60 * 60 * 1000,
        PEER_TICK_TIMEOUT: 1000,

        // bytes count to force peer disconnect
        PEER_MAX_BYTES_COUNT: 10 * 1024 * 1024,

        // time to force peer disconnect
        PEER_CONNECTION_LIFETIME: 60 * 60 * 1000,

        // time to restrict reconnection with peer
        PEER_RESTRICT_TIME: 2 * 60 * 1000,

        PEER_HEARTBEAT_TIMEOUT: 2 * 60 * 1000,
        PEER_DEAD_TIME: 6 * 60 * 1000,

        PEER_RECONNECT_INTERVAL: 2 * 60 * 1000,
        MEMPOOL_REANNOUNCE_INTERVAL: 10 * 60 * 1000,

        PEERMANAGER_BACKUP_TIMEOUT: 10 * 60 * 1000,

        // maximum block hashes in MSG_INV
        MAX_BLOCKS_INV: 300,

        // we expect that peer will respond with requested INV within this period
        INV_REQUEST_HOLDOFF: 1 * 60 * 1000,

        messageTypes: {
            MSG_VERSION: 'version',
            MSG_VERACK: 'verack',
            MSG_GET_ADDR: 'getaddr',
            MSG_ADDR: 'addr',
            MSG_REJECT: 'reject',
            MSG_BLOCK: 'block',
            MSG_TX: 'tx',
            MSG_INV: 'inv',
            MSG_GET_DATA: 'getdata',
            MSG_GET_BLOCKS: 'getblocks',
            MSG_GET_MEMPOOL: 'getmempool',
            MSG_PING: 'ping',
            MSG_PONG: 'pong',

            MSG_WITNESS_HANDSHAKE: 'w_handshake',
            MSG_WITNESS_NEXT_ROUND: 'w_nextround',
            MSG_WITNESS_EXPOSE: 'w_expose',
            MSG_WITNESS_BLOCK: 'w_block',
            MSG_WITNESS_BLOCK_VOTE: 'w_block_vote'
        },

        consensusStates: {
            ROUND_CHANGE: 'ROUND_CHANGE',
            BLOCK: 'BLOCK',
            VOTE_BLOCK: 'VOTE_BLOCK',
            COMMIT: 'COMMIT'
        },

        consensusTimeouts: {
            ROUND_CHANGE: 20000,
            BLOCK: 30000,
            VOTE_BLOCK: 20000,
            COMMIT: 30000
        },

        // maximum time offset for nodes we tolerate
        TOLERATED_TIME_DIFF: 60 * 60 * 1000,

        // how much we suppress creating empty blocks
        WITNESS_HOLDOFF: 2 * 60 * 1000,
        MAX_BLOCK_SIZE: 1024 * 1024,

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

        MEMPOOL_TX_QTY: 500,
        MEMPOOL_TX_LIFETIME: 24 * 60 * 60 * 1000,
        MEMPOOL_BAD_TX_CACHE: 10 * 60 * 1000,

        // TODO: review it. Heavy code will be terminated on slow nodes. And node become unsynced
        TIMEOUT_CODE: 10000,

        TX_STATUS_OK: 1,
        TX_STATUS_FAILED: 0,

        DB_PATH_PREFIX: './db',
        DB_CHAINSTATE_DIR: 'chainstate',
        DB_BLOCKSTATE_DIR: 'blockstate',
        DB_PEERSTATE_DIR: 'peerstate',
        DB_COINHISTORY_DIR: 'coinhistory',

        DB_TXINDEX_DIR: 'txindex',
        DB_WALLET_DIR: 'wallet',

        concilium: {
            HEIGHT_TO_RELEASE_ADD_ON: 1000,
            POS_CONCILIUM_ROUNDS: 20
        },

        forks: {
            HEIGHT_FORK_SERIALIZER: 3775,
            HEIGHT_FORK_CHANGE: 3775,
            HEIGHT_FORK_SERIALIZER_FIX2: 6100,
            HEIGHT_FORK_SERIALIZER_FIX3: 48000
        },

        BLOCK_CREATION_TIME_LIMIT: 1500,

        // if block older than it's parent (any) more than X second - prevent auto witnessing
        BLOCK_AUTO_WITNESSING_TIMESTAMP_DIFF: 30 * 60,

        CONTRACT_V_JSON: 2,
        CONTRACT_V_V8: 0,

        WITNESS_UTXOS_JOIN: 30,
        MAX_UTXO_PER_TX: 1000
    }
};
