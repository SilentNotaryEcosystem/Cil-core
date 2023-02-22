const path = require('path');
const protobuf = require('protobufjs');
const Mutex = require('mutex');

/**
 * Class to easy replacement used components
 */


const Crypto = require('./crypto/crypto');
const SerializerWrapper = require('./network/serializer');
const MessageAssemblerWrapper = require('./network/messageAssembler');
const PeerWrapper = require('./network/peer');
const PeerManagerWrapper = require('./network/peerManager');

const MessagesWrapper = require('./messages/index');

const WalletWrapper = require('./node/wallet');
const StoredWalletWrapper = require('./node/storedWallets');
const BftWrapper = require('./node/bftConsensus');
const NodeWrapper = require('./node/node');
const MempoolWrapper = require('./node/mempool');
const WitnessWrapper = require('./node/witness');
const RpcWrapper = require('./node/rpc');
const AppWrapper = require('./node/app');

const StorageWrapper = require('./storage/persistentStorage');
const PatchWrapper = require('./storage/patch');
const PendingBlocksManagerWrapper = require('./node/pendingBlocksManager');
const MainDagWrapper = require('./node/mainDag');
const RequestCacheWrapper = require('./node/requestsCache');

const CoinHistory = require('./structures/coinHistory');
const TransactionWrapper = require('./structures/transaction');
const BlockWrapper = require('./structures/block');
const InventoryWrapper = require('./structures/inventory');
const UtxoWrapper = require('./structures/utxo');
const CoinsWrapper = require('./structures/coins');

const BaseConciliumDefinition = require('./conciliums/baseConciliumDefinition');
const ConciliumClosedRR = require('./conciliums/conciliumRr');
const ConciliumPoS = require('./conciliums/conciliumPoS');

const BlockInfoWrapper = require('./structures/blockInfo');
const ArrayOfWrapper = require('./structures/arrayOf');
const ContractWrapper = require('./structures/contract');
const TxReceiptWrapper = require('./structures/txReceipt');

const utils = require('./utils');

const pack = require('./package');
const debugLib = require('debug');

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

// Inject default behavior
Error.prototype.log = function() {logger.error(this);};

class BaseFactory {
    constructor(options, objConstants) {

        this._mutexImplementation = Mutex;
        this._donePromise = new Promise(resolve => {
            this._asyncLoader()
                .then((prototypes) => {

                    // Order is mandatory!
                    // For example if Utxo depends on Coins implementation, you should implement Coins first
                    this._constants = {
                        ...this._constants,
                        ...prototypes.enumServices.values,
                        ...prototypes.enumRejectCodes.values,
                        ...prototypes.enumInventory.values,
                        ...prototypes.enumTxStatus.values
                    };

                    // prototypes
                    this._coinHistory = CoinHistory(this);
                    this._coinsImplementation = CoinsWrapper(this);
                    this._transactionImplementation = TransactionWrapper(this, prototypes);
                    this._blockImplementation = BlockWrapper(this, prototypes);
                    this._inventoryImplementation = InventoryWrapper(this, prototypes);
                    this._utxoImplementation = UtxoWrapper(this, prototypes);

                    this._baseConciliumDefinition = BaseConciliumDefinition;
                    this._conciliumRr = ConciliumClosedRR(this);
                    this._conciliumPoS = ConciliumPoS(this);

                    this._blockInfo = BlockInfoWrapper(this, prototypes);
                    this._arrayOfHashes = ArrayOfWrapper(32);
                    this._arrayOfAddresses = ArrayOfWrapper(20);
                    this._contract = ContractWrapper(this, prototypes);
                    this._txReceipt = TxReceiptWrapper(this, prototypes);

                    this._messagesImplementation = MessagesWrapper(this, prototypes);

                    //
                    this._serializerImplementation = SerializerWrapper(this.Messages);
                    this._messageAssemblerImplementation = MessageAssemblerWrapper(this.Serializer);

                    this._storedWalletImplementation = StoredWalletWrapper(this);

                    return prototypes;
                })
                .then(() => this.initSpecific())
                .then(() => {
                    this._peerImplementation = PeerWrapper(this);
                    this._peerManagerImplemetation = PeerManagerWrapper(this);
                    this._patchImplementation = PatchWrapper(this);
                    this._storageImplementation = StorageWrapper(this, options);
                    this._bftImplementation = BftWrapper(this);
                    this._mempoolImplementation = MempoolWrapper(this, options);
                    this._rpcImplementation = RpcWrapper(this);
                    this._appImplementation = AppWrapper(this);
                    this._pendingBlocksManagerImplementation = PendingBlocksManagerWrapper(this, options);
                    this._mainDagImplementation = MainDagWrapper(this);
                    this._requestCacheImplementation = RequestCacheWrapper(this);

                    // all componenst should be declared above
                    this._nodeImplementation = NodeWrapper(this, options);
                    this._witnessImplementation = WitnessWrapper(this, options);
                })
                .then(resolve)
                .catch(err => {
                    err.log();
                    process.exit(10);
                });
        });

        this._options = options;

        this._constants = {
            ...objConstants
        };
        this._walletImplementation = WalletWrapper(this.Crypto);
    }

    initSpecific() {
        throw('Implement!');
    }

    get Mutex() {
        return this._mutexImplementation;
    }

    get version() {
        const arrSubversions = pack.version.split('.');
        return parseInt(arrSubversions[0]) * Math.pow(2, 16) +
               parseInt(arrSubversions[1]) * Math.pow(2, 10) +
               parseInt(arrSubversions[2]);
    }

    get ConciliumRr() {
        return this._conciliumRr;
    }

    get ConciliumPos() {
        return this._conciliumPoS;
    }

    get BaseConciliumDefinition() {
        return this._baseConciliumDefinition;
    }

    get ArrayOfHashes() {
        return this._arrayOfHashes;
    }

    get ArrayOfAddresses() {
        return this._arrayOfAddresses;
    }

    get MainDag() {
        return this._mainDagImplementation;
    }

    get Contract() {
        return this._contract;
    }

    get TxReceipt() {
        return this._txReceipt;
    }

    get UTXO() {
        return this._utxoImplementation;
    }

    get Coins() {
        return this._coinsImplementation;
    }

    get PatchDB() {
        return this._patchImplementation;
    }

    get Application() {
        return this._appImplementation;
    }

    get RPC() {
        return this._rpcImplementation;
    }

    get RequestCache() {
        return this._requestCacheImplementation;
    }

    get Mempool() {
        return this._mempoolImplementation;
    }

    get Crypto() {
        return Crypto;
    }

    get Transport() {
        return this._transportImplemetation;
    }

    get Serializer() {
        return this._serializerImplementation;
    }

    get Network() {
        return this._networkImplementation;
    }

    get Wallet() {
        return this._walletImplementation;
    }

    get Constants() {
        return this._constants;
    }

    get Messages() {
        return this._messagesImplementation;
    }

    get BFT() {
        return this._bftImplementation;
    }

    get PeerManager() {
        return this._peerManagerImplemetation;
    }

    get Node() {
        return this._nodeImplementation;
    }

    get Witness() {
        return this._witnessImplementation;
    }

    get Peer() {
        return this._peerImplementation;
    }

    get Storage() {
        return this._storageImplementation;
    }

    get PendingBlocksManager() {
        return this._pendingBlocksManagerImplementation;
    }

    get MessageAssembler() {
        return this._messageAssemblerImplementation;
    }

    get Transaction() {
        return this._transactionImplementation;
    }

    get Block() {
        return this._blockImplementation;
    }

    get BlockInfo() {
        return this._blockInfo;
    }

    get Inventory() {
        return this._inventoryImplementation;
    }

    get StoredWallet() {
        return this._storedWalletImplementation;
    }

    get CoinHistory() {
        return this._coinHistory;
    }

    get utils() {
        return utils;
    }

    get FactoryOptions() {
        return this._options;
    }

    asyncLoad() {
        return this._donePromise;
    }

    async _asyncLoader() {
        return await this._loadMessagePrototypes();
    }

    /**
     *
     * @return {Promise<Object>} - compiled prototypes
     * @private
     */
    async _loadMessagePrototypes() {
        const protoNetwork = await protobuf.load(path.resolve(__dirname, './proto/network.proto'));
        const protoWitness = await protobuf.load(path.resolve(__dirname, './proto/witness.proto'));
        const protoStructures = await protobuf.load(path.resolve(__dirname, './proto/structures.proto'));

        return {

            // Node messages
            messageProto: protoNetwork.lookupType("network.Message"),
            versionPayloadProto: protoNetwork.lookupType("network.VersionPayload"),
            addrPayloadProto: protoNetwork.lookupType("network.AddrPayload"),
            rejectPayloadProto: protoNetwork.lookupType("network.RejectPayload"),
            getBlocksPayloadProto: protoNetwork.lookupType("network.GetBlocksPayload"),

            // part of messages
            peerInfoProto: protoNetwork.lookupType("network.PeerInfo"),

            // Witness messages
            witnessMessageProto: protoWitness.lookup("witness.WitnessMessage"),
            witnessNextRoundProto: protoWitness.lookup("witness.NextRound"),
            witnessBlockVoteProto: protoWitness.lookup("witness.BlockVote"),

            enumServices: protoNetwork.lookup("network.Services"),
            enumRejectCodes: protoNetwork.lookup("network.RejectCodes"),
            enumInventory: protoStructures.lookup("structures.InventoryTypes"),
            enumTxStatus: protoStructures.lookup("structures.TxStatuses"),

            // Structures
            transactionProto: protoStructures.lookupType("structures.Transaction"),
            transactionPayloadProto: protoStructures.lookupType("structures.TransactionPayload"),

            blockProto: protoStructures.lookupType("structures.Block"),
            blockHeaderProto: protoStructures.lookupType("structures.BlockHeader"),
            blockInfoProto: protoStructures.lookupType("structures.BlockInfo"),

            inventoryProto: protoStructures.lookupType("structures.Inventory"),

            utxoProto: protoStructures.lookupType("structures.UTXO"),

            contractProto: protoStructures.lookupType("structures.Contract"),
            txReceiptProto: protoStructures.lookupType("structures.TxReceipt")
        };
    }
}

module.exports = BaseFactory;
