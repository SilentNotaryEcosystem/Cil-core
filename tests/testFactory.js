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
const WalletWrapper = require('../node/wallet');
const MessagesWrapper = require('../messages/index');
const BftWrapper = require('../node/bftConsensus');
const PeerWrapper = require('../network/peer');
const PeerManagerWrapper = require('../network/peerManager');
const NodeWrapper = require('../node/node');
const WitnessWrapper = require('../node/witness');
const StorageWrapper = require('../storage/testStorage');
const TransactionWrapper = require('../structures/transaction');
const BlockWrapper = require('../structures/block');

const pack = require('../package');

class Factory {
    constructor() {

        this._donePromise = this._asyncLoader();
        this._donePromise.then(() => {
                this._serializerImplementation = SerializerWrapper(this.Messages);
                this._messageAssemblerImplementation = MessageAssemblerWrapper(this.Serializer);
                this._transportImplemetation = TransportWrapper(this.Serializer, this.MessageAssembler, this.Constants);
                this._peerImplementation = PeerWrapper(this.Messages, this.Transport, this.Constants);
                this._peerManagerImplemetation = PeerManagerWrapper(undefined, this.Constants, this.Messages, this.Peer);
                this._storageImplementation = StorageWrapper(this.Constants);
                this._bftImplementation = BftWrapper(this.Constants, this.Crypto, this.Messages);
                this._nodeImplementation = NodeWrapper(
                    this.Transport,
                    this.Messages,
                    this.Constants,
                    this.Peer,
                    this.PeerManager,
                    this.Storage
                );
                this._witnessImplementation = WitnessWrapper(
                    this.Node,
                    this.Messages,
                    this.Constants,
                    this.BFT,
                    this.Block
                );
            })
            .catch(err => {
                logger.error(err);
                process.exit(10);
            });

        this._constants = {
            ...config.constants
        };
        this._walletImplementation = WalletWrapper(Crypto);
    }

    get version() {
        const arrSubversions = pack.version.split('.');
        return parseInt(arrSubversions[0]) * Math.pow(2, 16) +
               parseInt(arrSubversions[1]) * Math.pow(2, 10) +
               parseInt(arrSubversions[2]);
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

    asyncLoad() {
        return this._donePromise;
    }

    async _asyncLoader() {
        const prototypes = await this._loadMessagePrototypes();
        const {
            blockProto, blockPayloadProto, transactionProto, transactionPayloadProto, enumServices, enumRejectCodes
        } = prototypes;

        this._transactionImplementation = TransactionWrapper(this.Crypto, transactionProto, transactionPayloadProto);
        this._blockImplementation = BlockWrapper(this.Crypto, blockProto, blockPayloadProto);

        this._messagesImplementation =
            MessagesWrapper(this.Constants, this.Crypto, this.Block, this.Transaction, prototypes);

        this._constants = {
            ...this._constants,
            ...enumServices.values,
            ...enumRejectCodes.values
        };
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
            messageProto: protoNetwork.lookupType("network.Message"),
            versionPayloadProto: protoNetwork.lookupType("network.VersionPayload"),
            peerInfoProto: protoNetwork.lookupType("network.PeerInfo"),
            addrPayloadProto: protoNetwork.lookupType("network.AddrPayload"),
            rejectPayloadProto: protoNetwork.lookupType("network.RejectPayload"),

            witnessMessageProto: protoWitness.lookup("witness.WitnessMessage"),
            witnessNextRoundProto: protoWitness.lookup("witness.NextRound"),

            enumServices: protoNetwork.lookup("network.Services"),
            enumRejectCodes: protoNetwork.lookup("network.RejectCodes"),

            transactionProto: protoStructures.lookupType("structures.Transaction"),
            transactionPayloadProto: protoStructures.lookupType("structures.TransactionPayload"),

            blockProto: protoStructures.lookupType("structures.Block"),
            blockPayloadProto: protoStructures.lookupType("structures.BlockPayload")
        };
    }
}

module.exports = new Factory();
