const {sleep} = require('../utils');
const debugLib = require('debug');

const debugWitness = debugLib('witness:app');
const debugWitnessMsg = debugLib('witness:messages');

module.exports = (Node, Messages, Constants, BFT) => {
    const {MsgVersion, MsgCommon, MsgReject} = Messages;
    const {MsgWitnessCommon, MsgWitnessNextRound, MsgWitnessWitnessExpose} = Messages;

    const {MSG_VERSION, MSG_VERACK} = Constants.messageTypes;
    const {MSG_WITNESS_NEXT_ROUND, MSG_WITNESS_EXPOSE} = Constants.messageTypes;

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

        /**
         * Establish connection for all groups which this witness listed (publicKey in group definition)
         *
         * @return {Promise<void>}
         */
        async start() {
            this._groups = await this._getMyGroups();
            this._consensuses = new Map();
            const mapDefinitions = await this._storage.getGroupDefinitions();

            for (let group of this._groups) {
                const consensus = new BFT({
                    group,
                    wallet: this._wallet,
                    arrPublicKeys: mapDefinitions.get(group)
                });
                this._consensuses.set(group, consensus);
                await this.startWitnessGroup(group);
            }

            // TODO: add watchdog to maintain connections to as much as possible witnesses
        }

        /**
         * Establish connection with other witnesses in specified group
         *
         * @param {String} groupName
         * @return {Promise<void>}
         */
        async startWitnessGroup(groupName) {
            const peers = await this._getGroupPeers(groupName);
            debugWitness(
                `******* "${this._debugAddress}" started WITNESS for group: "${groupName}" ${peers.length} peers *******`);

            for (let peer of peers) {
                debugWitness(`--------- "${this._debugAddress}" started WITNESS handshake with "${peer.address}" ----`);
                if (peer.disconnected) {
                    await this._connectToPeer(peer);
                    await peer.pushMessage(this._createMsgVersion());
                    await peer.loaded();
                } else {
                    debugWitness(`(address: "${this._debugAddress}") reusing connection to "${peer.address}"`);
                }
                if (!peer.disconnected) {

                    // to prove that it's real witness it should perform signed handshake
                    const handshakeMsg = this._createHandshakeMessage(groupName);
                    debugWitnessMsg(
                        `(address: "${this._debugAddress}") sending SIGNED message "${handshakeMsg.message}" to "${peer.address}"`);
                    await peer.pushMessage(handshakeMsg);
                    await Promise.race([peer.witnessLoaded(), sleep(Constants.PEER_QUERY_TIMEOUT)]);

                    if (peer.witnessLoadDone) {

                        // mark it for broadcast
                        peer.addTag(this._groups[0]);

                        // overwrite this peer definition with freshest data
                        this._peerManager.addPeer(peer);
                        debugWitness(`----- "${this._debugAddress}" WITNESS handshake with "${peer.address}" DONE ---`);
                    } else {
                        debugWitness(`----- "${this._debugAddress}" WITNESS "${peer.address}" TIMED OUT ---`);
                    }
                } else {
                    debugWitness(`----- "${this._debugAddress}" WITNESS "${peer.address}" DISCONNECTED ---`);
                }
            }
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
            return arrPeers;
        }

        async _connectToWitness(peer) {
            const address = this._transport.constructor.addressToString(peer.address);
            debugWitness(`(address: "${this._debugAddress}") connecting to witness ${address}`);
            return await peer.connect();
        }

        async _incomingWitnessMessage(peer, message) {
            const messageWitness = await this._checkPeerAndMessage(peer, message);
            if (!messageWitness) return;

            if (messageWitness.isHandshake()) {
                if (peer.inbound) {

                    // we don't check version & self connection because it's done on previous step (node connection)
                    const response = this._createHandshakeMessage(messageWitness.groupName);
                    debugWitnessMsg(
                        `(address: "${this._debugAddress}") sending SIGNED "${response.message}" to "${peer.address}"`);
                    await peer.pushMessage(response);
                    return;
                } else {
                    peer.witnessLoadDone = true;
                    return;
                }
            }

            // send a copy of received messages to other witnesses to maintain BFT
            if (!messageWitness.isBlock() && !messageWitness.isExpose()) {
                this._exposeMessageToWitnessGroup(messageWitness.groupName, messageWitness);
            }

            const consensus = this._consensuses.get(messageWitness.groupName);
            await this._processConsensusResult(consensus.processMessage(messageWitness));

            throw new Error(`Unhandled message type "${message.message}"`);
        }

        _processConsensusResult(result) {
            console.dir(result, {colors: true, depth: null});
            throw new Error('Should implement');
        }

        /**
         *
         * @param {Peer} peer
         * @param {MessageCommon} message
         * @return {WitnessMessageCommon | undefined}
         * @private
         */
        async _checkPeerAndMessage(peer, message) {
            let messageWitness;
            try {
                if (!message) {
                    logger.error(`Witness: "${this._debugAddress}" SIGNATURE CHECK FAILED!`);
                    peer.ban();
                    return undefined;
                }

                debugWitnessMsg(
                    `(address: "${this._debugAddress}") received SIGNED message "${message.message}" from "${peer.address}"`);

                messageWitness = new MsgWitnessCommon(message);
                const consensus = this._consensuses.get(messageWitness.groupName);
                if (!consensus) {
                    const rejectMsg = new MsgReject({
                        code: Constants.REJECT_BAD_WITNESS,
                        reason: 'Wrong group message'
                    });
                    debugWitnessMsg(
                        `(address: "${this._debugAddress}") sending message "${message.message}" to "${peer.address}"`);
                    await peer.pushMessage(rejectMsg);
                    peer.misbehave(5);
                    return undefined;
                }

                // check whether this witness belong to our group
                if (messageWitness.groupName !== messageWitness.content.toString() ||
                    !consensus.checkPublicKey(peer.publicKey)) {
                    logger.error(`Witness: "${this._debugAddress}" CHECK FAILED!`);
                    peer.ban();
                    return undefined;
                }
            } catch (err) {
                logger.error(`${err.message} Witness ${peer.remoteAddress}.`);
                peer.misbehave(1);
                return undefined;
            }
            return messageWitness;
        }

        _exposeMessageToWitnessGroup(groupName, message) {
            const msgExpose = new MsgWitnessWitnessExpose(message);
            msgExpose.sign();
            this._peerManager.broadcastToConnected(groupName, msgExpose);
        }

        /**
         *
         * @return {MsgWitnessCommon}
         * @private
         */
        _createHandshakeMessage(groupName) {
            const msg = new MsgWitnessCommon({groupName});
            msg.handshakeMessage = true;
            msg.sign(this._wallet.privateKey);
            return msg;
        }

    };
};
