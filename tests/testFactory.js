const protobuf = require("protobufjs");

// TODO: add logger

/**
 * Class to easy replacement used components
 */

const config = require('../config/prod.conf');

const Crypto = require('../crypto/crypto');
const TransportWrapper = require('../network/testTransport');
const SerializerWrapper = require('../network/serializer');
const WalletWrapper = require('../wallet/wallet');
const MessagesWrapper = require('../messages/index');
const BftWrapper = require('../node/bftConsensus');

const pack = require('../package');

class Factory {
    constructor() {

        this._donePromise = this._asyncLoader();
        this._donePromise.then(() => {
                this._serializerImplementation = SerializerWrapper(this._messagesImplementation);
                this._transportImplemetation = TransportWrapper(this._serializerImplementation);
            })
            .catch(err => {
                console.error(err);
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

    get Peer() {
        return this._peerImplementation;
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

    async _asyncLoader() {
        const prototypes = await this._loadMessagePrototypes();
        this._messagesImplementation = MessagesWrapper(config.network, prototypes);
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
            enumServices: protoNetwork.lookup("network.Services")
        };
    }
}

module.exports = new Factory();
