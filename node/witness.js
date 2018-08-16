const debugLib = require('debug');

const debugWitness = debugLib('witness:app');
const debugWitnessMsg = debugLib('witness:messages');

module.exports = (Node, Messages, Constants) => {
    const {MsgVersion, MsgCommon} = Messages;

    return class Witness extends Node {
        constructor(options = {}) {
            super(options);
            const {wallet} = options;

            // upgrade capabilities from regular Node to Witness
            this._myPeerInfo.addCapability({service: Constants.WITNESS, data: Buffer.from(wallet.publicKey, 'hex')});

            this._wallet = wallet;
            if (!this._wallet) throw new Error('Pass wallet into witness');

            this._peerManager.on('witnessMessage', this._incomingWitnessMessage.bind(this));
        }

        async start() {

            // TODO: add support for multiple groups
            this._groups = await this._getMyGroups();
            const peers = await this._getGroupPeers(this._groups[0]);
            for (let peer of peers) {
                debugWitness(`--------- "${this._debugAddress}" started WITNESS handshake with "${peer.address}" ----`);
                if (peer.disconnected) {
                    await this._connectToPeer(peer);
                    await peer.pushMessage(this._createMsgVersion());
                    await peer.loaded();
                }
                if (!peer.disconnected) {

                    // to prove that it's real witness it should perform signed handshake
                    debugWitnessMsg(
                        `(address: "${this._debugAddress}") sending SIGNED message "version" to "${peer.address}"`);
                    await peer.pushMessage(this._createHandshakeMessage());
                    await peer.witnessLoaded();
                    peer.addTag(this._groups[0]);

                    // overwrite this peer definition with freshest data
                    this._peerManager.addPeer(peer);
                }
                debugWitness(`--------- "${this._debugAddress}" WITNESS handshake with "${peer.address}" DONE -----`);
            }

            // TODO: add watchdog to mantain connections to as much as possible witnesses
        }

        /**
         *
         * @return {Array} of group names this witness participates
         * @private
         */
        async _getMyGroups() {
            const myPubKey = this._wallet.publicKey;
            const mapDefinitions = await this._storage.getGroupDefinitions();
            const arrGroups = [];
            for (let [groupName, arrKeys] of mapDefinitions) {

                // == because it will be casted to String
                if (~arrKeys.findIndex(key => key == myPubKey)) arrGroups.push(groupName);
            }

            return arrGroups;
        }

        /**
         *
         * @param {String} group - witness group
         * @return {Array} of Peers with capability WITNESS which belongs to group
         * @private
         */
        async _getGroupPeers(group) {
            const mapDefinitions = await this._storage.getGroupDefinitions();
            const arrGroupKeys = mapDefinitions.get(group);
            const arrAllWitnessesPeers = this._peerManager.filterPeers({service: Constants.WITNESS});
            const arrPeers = [];
            for (let peer of arrAllWitnessesPeers) {
                if (~arrGroupKeys.findIndex(key => {
                        const buffKey = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
                        return buffKey.equals(peer.publicKey);
                    })) {
                    arrPeers.push(peer);
                }
            }
            ;
            return arrPeers;
        }

        async _connectToWitness(peer) {
            const address = this._transport.constructor.addressToString(peer.address);
            debugWitness(`(address: "${this._debugAddress}") connecting to witness ${address}`);
            return await peer.connect();
        }

        async _incomingWitnessMessage(peer, message) {
            try {
                if (!message) {
                    logger.error(`Witness: "${this._debugAddress}" SIGNATURE CHECK FAILED!`);
                    peer.ban();
                    return;
                }

                debugWitnessMsg(
                    `(address: "${this._debugAddress}") received SIGNED message "${message.message}" from "${peer.address}"`);

                if (message.isVersion()) {
                    // we don't check version & self connection because it's done on prevoius step (node connection)

                    const msgVerack = new MsgCommon();
                    msgVerack.verAckMessage = true;
                    msgVerack.sign(this._wallet.privateKey);
                    debugWitnessMsg(`(address: "${this._debugAddress}") sending SIGNED "verack" to "${peer.address}"`);
                    await peer.pushMessage(msgVerack);
                    return;
                } else if (message.isVerAck()) {
                    peer.witnessLoadDone = true;
                    return;
                }

                throw new Error(`Unhandled message type "${message.message}"`);
            } catch (err) {
                logger.error(`${err.message} Witness ${peer.remoteAddress}.`);
                peer.misbehave(1);
            }
        }

        async _handleWitnessVersionMessage(peer) {
        }

        /**
         *
         * @return {MessageVersion}
         * @private
         */
        _createHandshakeMessage() {
            const msg = new MsgVersion({nonce: this._nonce});
            msg.sign(this._wallet.privateKey);
            return msg;
        }
    };
};
