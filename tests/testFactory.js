const protobuf = require("protobufjs");
const debug = require('debug');

// Uncomment in prod!!
//const error=debug('app:error');
//const log=debug('app:log');
//log.log = console.log.bind(console);
//const info=debug('app:info');
//info.log = console.info.bind(console);

const error = console.error;
const log = console.log;
const info = console.info;

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
const PeerManagerWrapper = require('../network/peerManager');
const NodeWrapper = require('../node/node');

const pack = require('../package');

class Factory {
    constructor() {

        // simple logger
        global.logger = {
            error: msg => error(msg),
            log: msg => log(msg),
            info: msg => info(msg)
        };

        this._donePromise = this._asyncLoader();
        this._donePromise.then(() => {
                this._serializerImplementation = SerializerWrapper(this.Messages);
                this._transportImplemetation = TransportWrapper(this.Serializer, this.Constants);
                this._peerManagerImplemetation = PeerManagerWrapper(undefined, this.Constants, this.Messages);

                this._nodeImplementation = NodeWrapper(this.Transport, this.Messages, this.Constants, this.PeerManager);
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

    asyncLoad() {
        return this._donePromise;
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
