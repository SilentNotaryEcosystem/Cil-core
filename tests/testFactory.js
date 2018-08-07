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
const WalletWrapper = require('../wallet/wallet');
const MessagesWrapper = require('../messages/index');
const BftWrapper = require('../node/bftConsensus');
const PeerWrapper = require('../network/peer');
const PeerManagerWrapper = require('../network/peerManager');
const NodeWrapper = require('../node/node');

const pack = require('../package');

class Factory {
    constructor() {

        this._donePromise = this._asyncLoader();
        this._donePromise.then(() => {
                this._serializerImplementation = SerializerWrapper(this.Messages);
                this._transportImplemetation = TransportWrapper(this.Serializer, this.Constants);
                this._peerImplementation = PeerWrapper(this.Messages, this.Constants);
                this._peerManagerImplemetation = PeerManagerWrapper(undefined, this.Constants, this.Messages, this.Peer);
                this._nodeImplementation =
                    NodeWrapper(this.Transport, this.Messages, this.Constants, this.Peer, this.PeerManager
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
        this._bftImplementation = BftWrapper(Crypto);
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

    get Peer() {
        return this._peerImplementation;
    }

    asyncLoad() {
        return this._donePromise;
    }

    async _asyncLoader() {
        const prototypes = await this._loadMessagePrototypes();
        this._messagesImplementation = MessagesWrapper(this.Constants, prototypes);
        this._constants = {
            ...this._constants,
            ...prototypes.enumServices.values
        };
    }

    /**
     *
     * @return {Promise<Object>} - compiled prototypes
     * @private
     */
    async _loadMessagePrototypes() {
        const protoNetwork = await protobuf.load('./messages/proto/network.proto');

        return {
            messageProto: protoNetwork.lookupType("network.Message"),
            versionPayloadProto: protoNetwork.lookupType("network.VersionPayload"),
            peerInfoProto: protoNetwork.lookupType("network.PeerInfo"),
            addrPayloadProto: protoNetwork.lookupType("network.AddrPayload"),
            enumServices: protoNetwork.lookup("network.Services")
        };
    }
}

module.exports = new Factory();
