const {sleep} = require('../utils');
const debugLib = require('debug');

const debugWitness = debugLib('witness:app');
const debugWitnessMsg = debugLib('witness:messages');

module.exports = (factory) => {
    const {Node, Messages, Constants, BFT, Block, Transaction, WitnessGroupDefinition, PatchDB} = factory;
    const {MsgWitnessCommon, MsgWitnessBlock, MsgWitnessWitnessExpose} = Messages;

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
            const arrGroupDefinitions = await this._storage.getGroupsByKey(this._wallet.publicKey);

            for (let def of arrGroupDefinitions) {
                await this._createConsensusForGroup(def);
                await this.startWitnessGroup(def);
            }

            // TODO: add watchdog to maintain connections to as much as possible witnesses
        }

        /**
         * Establish connection with other witnesses in specified group
         *
         * @param {WitnessGroupDefinition} groupDefinition
         * @return {Promise<void>}
         */
        async startWitnessGroup(groupDefinition) {
            const peers = await this._getGroupPeers(groupDefinition);
            debugWitness(
                `******* "${this._debugAddress}" started WITNESS for group: "${groupDefinition.getGroupName()}" ${peers.length} peers *******`);

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
                    const handshakeMsg = this._createHandshakeMessage(groupDefinition.getGroupName());
                    debugWitnessMsg(
                        `(address: "${this._debugAddress}") sending SIGNED message "${handshakeMsg.message}" to "${peer.address}"`);
                    await peer.pushMessage(handshakeMsg);
                    await Promise.race([peer.witnessLoaded(), sleep(Constants.PEER_QUERY_TIMEOUT)]);

                    if (peer.witnessLoadDone) {

                        // mark it for broadcast
                        peer.addTag(groupDefinition.getGroupName());

                        // overwrite this peer definition with freshest data
                        this._peerManager.addPeer(peer);
                        debugWitness(`----- "${this._debugAddress}" WITNESS handshake with "${peer.address}" DONE ---`);
                    } else {
                        debugWitness(`----- "${this._debugAddress}" WITNESS "${peer.address}" TIMED OUT ---`);
                    }
                } else {
                    debugWitness(`----- "${this._debugAddress}" WITNESS "${peer.address}" DISCONNECTED ---`);
                }

                // TODO: request mempool tx from neighbor with MSG_MEMPOOL (https://en.bitcoin.it/wiki/Protocol_documentation#mempool)
            }
        }

        /**
         *
         * @param {WitnessGroupDefinition} groupDefinition
         * @returns {Promise<void>}
         * @private
         */
        async _createConsensusForGroup(groupDefinition) {
            const consensus = new BFT({
                groupDefinition,
                wallet: this._wallet
            });
            this._setConsensusHandlers(consensus);
            this._consensuses.set(groupDefinition.getGroupName(), consensus);
        }

        /**
         *
         * @param {WitnessGroupDefinition} groupDefinition
         * @return {Array} of Peers with capability WITNESS which belongs to group
         * @private
         */
        async _getGroupPeers(groupDefinition) {
            const arrGroupKeys = groupDefinition.getPublicKeys();
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

        //TODO: fix duplicate connections handling
//        async _connectToWitness(peer) {
//            const address = this._transport.constructor.addressToString(peer.address);
//            debugWitness(`(address: "${this._debugAddress}") connecting to witness ${address}`);
//            return await peer.connect();
//        }

        async _incomingWitnessMessage(peer, message) {
            try {
                const messageWitness = this._checkPeerAndMessage(peer, message);
                const consensus = this._consensuses.get(messageWitness.groupName);

                if (messageWitness.isHandshake()) {
                    await this._processHandshakeMessage(peer, messageWitness, consensus);
                    return;
                }

//                if(!peer.witnessLoadDone) {
//                    peer.ban();
//                    throw new Error('Peer missed handshake stage');
//                }

                if (messageWitness.isWitnessBlock()) {
                    await this._processBlockMessage(peer, messageWitness, consensus);
                    return;
                }

                // send a copy of received messages to other witnesses to maintain BFT
                if (!messageWitness.isExpose()) {
                    const exposeMsg = this._createExposeMessage(messageWitness);
                    this._broadcastConsensusInitiatedMessage(exposeMsg);
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

                // this will advance us to VOTE_BLOCK state whether block valid or not!
                const msgBlock = new MsgWitnessBlock(messageWitness);
                const block = msgBlock.block;
                try {
                    await this._processBlock(block);

                    consensus.processValidBlock(block);
                } catch (e) {
                    consensus.invalidBlock();
                }
            } else {

                // we still wait for block from designated proposer or timer for BLOCK state will expire
                debugWitness(
                    `(address: "${this._debugAddress}") "${peer.address}" creates a block, but not it's turn!`);
            }
        }

        /**
         *
         * @param {Peer} peer
         * @param {MessageCommon | undefined} message undefined means that signature check for witness peer failed (@see peer._setConnectionHandlers)
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
                this._broadcastConsensusInitiatedMessage(message);
            });
            consensus.on('createBlock', async () => {
                try {
                    const block = await this._createBlockAndBroadcast(consensus);
                    consensus.processValidBlock(block);
                } catch (e) {
                    if (typeof e === 'number') {
                        this._suppressedBlockHandler();
                    } else {
                        logger.error(e.message);
                    }
                }
            });
            consensus.on('commitBlock', async (block) => {
                await this._commitBlock(block);
                logger.log(
                    `Witness: "${this._debugAddress}" block "${block.hash()}" Round: ${consensus._roundNo} commited at ${new Date} `);
            });
        }

        /**
         *
         *
         * @private
         */
        _suppressedBlockHandler() {
            debugWitness('Suppressing empty block');
        }

        /**
         * Wrap, sign, broadcast received message - expose that message to other
         *
         * @param {WitnessMessageCommon} message
         * @return {WitnessExpose}
         * @private
         */
        _createExposeMessage(message) {
            const msgExpose = new MsgWitnessWitnessExpose(message);
            debugWitness(`Witness: "${this._debugAddress}" EXPOSING message "${message.message}" to neighbors`);
            msgExpose.sign(this._wallet.privateKey);
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

        /**
         * Create block, and it it's not empty broadcast MSG_WITNESS_BLOCK to other witnesses
         *
         * @param {BftConsensus} consensusInstance
         * @returns {Promise<*>}
         * @private
         */
        async _createBlockAndBroadcast(consensusInstance) {
            const {groupName, groupId} = consensusInstance;

            // empty block - is ok, just don't store it on COMMIT stage
            const msg = new MsgWitnessBlock({groupName});
            const block = await this._createBlock(groupId);

            // suppress empty blocks
            if (block.isEmpty() && !consensusInstance.timeForWitnessBlock()) {
                throw (0);
            }

            msg.block = block;
            msg.sign(this._wallet.privateKey);

            this._peerManager.broadcastToConnected(groupName, msg);
            return block;
        }

        _broadcastConsensusInitiatedMessage(msg) {
            const groupName = msg.groupName;
            this._peerManager.broadcastToConnected(groupName, msg);
            const consensusInstance = this._consensuses.get(groupName);

            // set my own view
            consensusInstance.processMessage(msg);
        }

        async _createBlock(groupId) {

            // TODO: get tips for parents
            const block = new Block(groupId);

            // TODO: replace it for patch for current level
            const patchState = new PatchDB();
            const arrBadHashes = [];
            let totalFee = 0;
            for (let tx of this._mempool.getFinalTxns(groupId)) {
                const mapUtxos = await this._storage.getUtxosCreateMap(tx.utxos);
                try {
                    const {fee} = await this._app.processTx(tx, mapUtxos, patchState, false);
                    if (fee < Constants.MIN_TX_FEE) throw new Error(`Fee of ${fee} too small in "${tx.hash()}"`);
                    totalFee += fee;
                    block.addTx(tx);
                } catch (e) {
                    logger.error(e);
                    arrBadHashes.push(tx.hash());
                }
            }
            if (arrBadHashes.length) this._mempool.removeTxns(arrBadHashes);

            // TODO: Store patch in DAG for pending blocks
            block.finish(totalFee, this._wallet.publicKey);
            debugWitness(`Block ${block.hash()} ready`);

            return block;
        }

        async _commitBlock(block) {

            //TODO: check finality
        }

    };
};
