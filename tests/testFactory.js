const protobuf = require("protobufjs");
const debugLib = require('debug');

// Uncomment in prod!!
//const error=debugLib('app:error');
//const log=debugLib('app:log');
//log.log = console.log.bind(console);
//const info=debugLib('app:info');
//info.log = console.info.bind(console);
//const debug=debugLib('app:debug');
//debug.log = console.log.bind(console);
// simple logger
//global.logger = {
//    error: msg => error(msg),
//    log: msg => log(msg),
//    info: msg => info(msg)
//    debug: msg => debug(msg)
//};

// Remove in prod
global.logger = console;
global.logger.debug = console.log;

/**
 * Class to easy replacement used components
 */

const config = require('../config/test.conf');

const Crypto = require('../crypto/crypto');
const TransportWrapper = require('../network/testTransport');
const SerializerWrapper = require('../network/serializer');
const MessageAssemblerWrapper = require('../network/messageAssembler');
const PeerWrapper = require('../network/peer');
const PeerManagerWrapper = require('../network/peerManager');

const MessagesWrapper = require('../messages/index');

const WalletWrapper = require('../node/wallet');
const BftWrapper = require('../node/bftConsensus');
const NodeWrapper = require('../node/node');
const MempoolWrapper = require('../node/mempool');
const WitnessWrapper = require('../node/witness');
const RpcWrapper = require('../node/rpc');
const AppWrapper = require('../node/app');

const StorageWrapper = require('../storage/memoryStorage');
const PatchWrapper = require('../storage/patch');

const TransactionWrapper = require('../structures/transaction');
const BlockWrapper = require('../structures/block');
const InventoryWrapper = require('../structures/inventory');
const UtxoWrapper = require('../structures/utxo');
const CoinsWrapper = require('../structures/coins');
const WitnessGroupDefinition = require('../structures/witnessGroupDefinition');

const pack = require('../package');

class Factory {
    constructor() {

        this._donePromise = this._asyncLoader();
        this._donePromise.then((prototypes) => {

                // Order is mandatory!
                // For example if Utxo depends on Coins implementation, you should implement Coins first
                this._constants = {
                    ...this._constants,
                    ...prototypes.enumServices.values,
                    ...prototypes.enumRejectCodes.values,
                    ...prototypes.enumInventory.values
                };

                // prototypes
                this._coinsImplementation = CoinsWrapper(this);
                this._transactionImplementation =
                    TransactionWrapper(this, prototypes);
                this._blockImplementation = BlockWrapper(this, prototypes);
                this._inventoryImplementation = InventoryWrapper(this, prototypes);
                this._messagesImplementation =
                    MessagesWrapper(this, prototypes);
                this._utxoImplementation = UtxoWrapper(this, prototypes);
                this._witnessGroupDefinition = WitnessGroupDefinition(this, prototypes);

                //
                this._serializerImplementation = SerializerWrapper(this.Messages);
                this._messageAssemblerImplementation = MessageAssemblerWrapper(this.Serializer);
                this._transportImplemetation = TransportWrapper(this);
                this._peerImplementation = PeerWrapper(this);
                this._peerManagerImplemetation = PeerManagerWrapper(this);
                this._storageImplementation = StorageWrapper(this);
                this._bftImplementation = BftWrapper(this);
                this._mempoolImplementation = MempoolWrapper(this);
                this._rpcImplementation = RpcWrapper(this);
                this._patchImplementation = PatchWrapper(this);
                this._appImplementation = AppWrapper(this);

                // all componenst should be declared above
                this._nodeImplementation = NodeWrapper(this);
                this._witnessImplementation = WitnessWrapper(this);
            })
            .catch(err => {
                logger.error(err);
                process.exit(10);
            });

        this._constants = {
            ...config.constants
        };
        this._walletImplementation = WalletWrapper(this.Crypto);
    }

    get version() {
        const arrSubversions = pack.version.split('.');
        return parseInt(arrSubversions[0]) * Math.pow(2, 16) +
               parseInt(arrSubversions[1]) * Math.pow(2, 10) +
               parseInt(arrSubversions[2]);
    }

    get WitnessGroupDefinition() {
        return this._witnessGroupDefinition;
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

    get MessageAssembler() {
        return this._messageAssemblerImplementation;
    }

    get Transaction() {
        return this._transactionImplementation;
    }

    get Block() {
        return this._blockImplementation;
    }

    get Inventory() {
        return this._inventoryImplementation;
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
        const protoNetwork = await protobuf.load('./proto/network.proto');
        const protoWitness = await protobuf.load('./proto/witness.proto');
        const protoStructures = await protobuf.load('./proto/structures.proto');

        return {

            // Node messages
            messageProto: protoNetwork.lookupType("network.Message"),
            versionPayloadProto: protoNetwork.lookupType("network.VersionPayload"),
            addrPayloadProto: protoNetwork.lookupType("network.AddrPayload"),
            rejectPayloadProto: protoNetwork.lookupType("network.RejectPayload"),

            // part of messages
            peerInfoProto: protoNetwork.lookupType("network.PeerInfo"),

            // Witness messages
            witnessMessageProto: protoWitness.lookup("witness.WitnessMessage"),
            witnessNextRoundProto: protoWitness.lookup("witness.NextRound"),
            witnessBlockVoteProto: protoWitness.lookup("witness.BlockVote"),

            enumServices: protoNetwork.lookup("network.Services"),
            enumRejectCodes: protoNetwork.lookup("network.RejectCodes"),
            enumInventory: protoStructures.lookup("structures.InventoryTypes"),

            // Structures
            transactionProto: protoStructures.lookupType("structures.Transaction"),
            transactionPayloadProto: protoStructures.lookupType("structures.TransactionPayload"),

            blockProto: protoStructures.lookupType("structures.Block"),
            blockHeaderProto: protoStructures.lookupType("structures.BlockHeader"),

            inventoryProto: protoStructures.lookupType("structures.Inventory"),

            utxoProto: protoStructures.lookupType("structures.UTXO"),

            witnessGroupDefinitionProto: protoStructures.lookupType("structures.WitnessGroupDefinition")
        };
    }
}

module.exports = new Factory();
