const {sleep} = require('../utils');
const debugLib = require('debug');

const debugWitness = debugLib('witness:app');
const debugWitnessMsg = debugLib('witness:messages');

module.exports = (Node, Messages, Constants, BFT, Block) => {
    const {MsgVersion, MsgCommon, MsgReject, MsgBlock} = Messages;
    const {MsgWitnessCommon, MsgWitnessNextRound, MsgWitnessBlock, MsgWitnessWitnessExpose} = Messages;

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

            this._consensuses = new Map();
        }

        /**
         * Establish connection for all groups which this witness listed (publicKey in group definition)
         *
         * @return {Promise<void>}
         */
        async start() {
            this._groups = await this._getMyGroups();

            for (let group of this._groups) {
                await this._createConsensusForGroup(group);
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

        async _createConsensusForGroup(group) {
            const mapDefinitions = await this._storage.getGroupDefinitions();

            const consensus = new BFT({
                groupName: group,
                wallet: this._wallet,
                arrPublicKeys: mapDefinitions.get(group)
            });
            this._setConsensusHandlers(consensus);
            this._consensuses.set(group, consensus);
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
            try {
                const messageWitness = this._checkPeerAndMessage(peer, message);
                const consensus = this._consensuses.get(messageWitness.groupName);

                if (messageWitness.isHandshake()) {
                    await this._processHandshakeMessage(peer, messageWitness, consensus);
                    return;
                }
                if (messageWitness.isWitnessBlock()) {
                    await this._processBlockMessage(peer, messageWitness, consensus);
                    return;
                }

                // send a copy of received messages to other witnesses to maintain BFT
                if (!messageWitness.isExpose()) {
                    const msg = this._exposeMessageToWitnessGroup(messageWitness.groupName, messageWitness);
                    consensus.processMessage(msg);
                }
                debugWitness(`(address: "${this._debugAddress}") sending data to BFT: ${messageWitness.content}`);
                consensus.processMessage(messageWitness);
            } catch (e) {
                logger.error(e);
            }
        }

        async _processHandshakeMessage(peer, messageWitness, consensus) {

            // check whether this witness belong to our group
            if (!consensus.checkPublicKey(peer.publicKey)) {
                peer.ban();
                throw(`Witness: "${this._debugAddress}" this guy UNKNOWN!`);
            }

            if (peer.inbound) {

                // we don't check version & self connection because it's done on previous step (node connection)
                const response = this._createHandshakeMessage(messageWitness.groupName);
                debugWitnessMsg(
                    `(address: "${this._debugAddress}") sending SIGNED "${response.message}" to "${peer.address}"`);
                await peer.pushMessage(response);
                peer.addTag(messageWitness.groupName);
            } else {
                peer.witnessLoadDone = true;
            }
        }

        async _processBlockMessage(peer, messageWitness, consensus) {
            if (consensus.shouldPublish(messageWitness.publicKey)) {
                const msgBlock = new MsgWitnessBlock(messageWitness);
                const block = msgBlock.block;
                if (!this._verifyBlock(block)) throw new Error('Failed to verify block');
                consensus.processValidBlock(block);

                const msgBlockAck = new MsgWitnessCommon({groupName: consensus.groupName});
                msgBlockAck.blockackMessage = true;
                msgBlockAck.sign(this._wallet.privateKey);

                // send our ACK block to consensus
                this._peerManager.broadcastToConnected(consensus.groupName, msgBlockAck);
            }
        }

        /**
         *
         * @param {Peer} peer
         * @param {MessageCommon} message
         * @return {WitnessMessageCommon | undefined}
         * @private
         */
        _checkPeerAndMessage(peer, message) {
            let messageWitness;
            if (!message) {
                peer.ban();
                throw new Error(`Witness: "${this._debugAddress}" SIGNATURE CHECK FAILED!`);
            }

            debugWitnessMsg(
                `(address: "${this._debugAddress}") received SIGNED message "${message.message}" from "${peer.address}"`);

            messageWitness = new MsgWitnessCommon(message);
            const consensus = this._consensuses.get(messageWitness.groupName);
            if (!consensus) {
                peer.ban();
                throw new Error(`Witness: "${this._debugAddress}" send us message for UNKNOWN GROUP!`);
            }

            return messageWitness;
        }

        _setConsensusHandlers(consensus) {
            consensus.on('message', message => {
                debugWitness(`Witness: "${this._debugAddress}" message "${message.message}" from CONSENSUS engine`);
                this._peerManager.broadcastToConnected(consensus.groupName, message);
            });
            consensus.on('createBlock', () => {
                const block = this._createAndBroadcastBlock(consensus.groupName);
                consensus.processValidBlock(block);
            });
        }

        /**
         * Wrap, sign, broadcast received message - expose that message to other
         *
         * @param {String}groupName
         * @param {WitnessMessageCommon} message
         * @return {WitnessExpose}
         * @private
         */
        _exposeMessageToWitnessGroup(groupName, message) {
            const msgExpose = new MsgWitnessWitnessExpose(message);
            debugWitness(`Witness: "${this._debugAddress}" EXPOSING message "${message.message}" to neighbors`);
            msgExpose.sign(this._wallet.privateKey);
            this._peerManager.broadcastToConnected(groupName, msgExpose);
            return msgExpose;
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

        _verifyBlock(blockContent) {

            // TODO: implement
            return true;
        }

        _createAndBroadcastBlock(groupName) {

            // TODO: implement
            const msg = new MsgWitnessBlock({groupName});
            const block = new Block();
            msg.block = block;
            msg.sign(this._wallet.privateKey);

            // empty block - is ok, just don't store it on COMMIT stage
            this._peerManager.broadcastToConnected(groupName, msg);
            return block;
        }
    };
};
