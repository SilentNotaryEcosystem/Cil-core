const assert = require('assert');
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
            const arrGroupDefinitions = await this._storage.getWitnessGroupsByKey(this._wallet.publicKey);

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

        /**
         * Block received from proposer witness
         *
         * @param {Peer} peer
         * @param {MsgWitnessCommon} messageWitness
         * @param {BFT} consensus
         * @returns {Promise<void>}
         * @private
         */
        async _processBlockMessage(peer, messageWitness, consensus) {
            if (consensus.shouldPublish(messageWitness.publicKey)) {

                // this will advance us to VOTE_BLOCK state whether block valid or not!
                const msgBlock = new MsgWitnessBlock(messageWitness);
                const block = msgBlock.block;
                if (await this._storage.hasBlock(block.hash())) {
                    logger.error(`Block ${block.hash()} already known!`);
                    return;
                }
                try {

                    // check block without checking signatures
                    await this._verifyBlock(block, false);
                    const patchState = await this._processBlock(block);

                    // no _accept here, because this block should be voted before
                    consensus.processValidBlock(block, patchState);
                } catch (e) {
                    logger.error(e);
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
                    const {groupName, groupId} = consensus;
                    const {block, patch} = await this._createBlock(groupId);
                    if (block.isEmpty() && !consensus.timeForWitnessBlock()) {
                        throw (0);
                    }

                    await this._broadcastBlock(groupName, block);

                    consensus.processValidBlock(block, patch);
                } catch (e) {
                    if (typeof e === 'number') {
                        this._suppressedBlockHandler();
                    } else {
                        logger.error(e);
                    }
                }
            });
            consensus.on('commitBlock', async (block, patch) => {
                await this._acceptBlock(block, patch);
                logger.log(
                    `Witness: "${this._debugAddress}" block "${block.hash()}" Round: ${consensus._roundNo} commited at ${new Date} `);
                await this._postAccepBlock();
                consensus.blockCommited();
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
         * @param {String} groupName
         * @param {Block} block
         * @returns {Promise<*>}
         * @private
         */
        async _broadcastBlock(groupName, block) {
            const msg = new MsgWitnessBlock({groupName});

            msg.block = block;
            msg.sign(this._wallet.privateKey);

            this._peerManager.broadcastToConnected(groupName, msg);
            debugWitness(`Witness: "${this._debugAddress}". Block ${block.hash()} broadcasted`);
        }

        _broadcastConsensusInitiatedMessage(msg) {
            const groupName = msg.groupName;
            this._peerManager.broadcastToConnected(groupName, msg);
            const consensusInstance = this._consensuses.get(groupName);

            // set my own view
            consensusInstance.processMessage(msg);
        }

        /**
         *
         * @param {Number} groupId - for which witnessGroupId we create block
         * @returns {Promise<{block, patch}>}
         * @private
         */
        async _createBlock(groupId) {

            const block = new Block(groupId);
            const arrTips = this._getTips();
            const {arrParents, patchMerged, mci} = await this._getBestParents(arrTips);
            assert(Array.isArray(arrParents) && arrParents.length, 'Couldn\'t get parents for block!');
            block.parentHashes = arrParents;
            block.mci = mci;

            const arrBadHashes = [];
            let totalFee = 0;
            for (let tx of this._mempool.getFinalTxns(groupId)) {
                const mapUtxos = await this._storage.getUtxosCreateMap(tx.utxos);
                try {
                    const {fee} = await this._app.processTx(tx, mapUtxos, patchMerged, false);
                    if (fee < Constants.MIN_TX_FEE) throw new Error(`Fee of ${fee} too small in "${tx.hash()}"`);
                    totalFee += fee;
                    block.addTx(tx);
                } catch (e) {
                    logger.error(e);
                    arrBadHashes.push(tx.hash());
                }
            }

            // remove failed txns
            if (arrBadHashes.length) this._mempool.removeTxns(arrBadHashes);

            // TODO: Store patch in DAG for pending blocks
            block.finish(totalFee, this._wallet.publicKey);
            debugWitness(`Witness: "${this._debugAddress}". Block ${block.hash()} with ${block.txns.length - 1} ready`);

            return {block, patch: patchMerged};
        }

        /**
         *
         * @returns {Array} of tips (free vertexes in graph)
         * @private
         */
        _getTips() {
            const arrTips = this._dagPendingBlocks.tips;

            // TODO: it's A STUB! maintain graph of pending blocks (store it + load it)
            return !arrTips.length ? [Constants.GENEZIS_BLOCK] : arrTips;
        }

        /**
         * It will check "compatibility" of tips (ability to merge patches)
         *
         * @param {Array} arrTips - of vertices (string hashes of respective pending block) in pending blocks DAG
         * @returns {arrParents, mci} - mci for new block
         * @private
         */
        async _getBestParents(arrTips) {

            // TODO: consider using process.nextTick() (this could be time consuming)
            // @see https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick/
            const arrParents = [];
            let mci = 1;

            // get max witnessed path for all tips
            const arrWitnessNums = arrTips.map(vertex => this._getVertexWitnessNum(vertex));

            // sort it descending
            const sortedDownTipIndexes = arrTips
                .map((e, i) => i)
                .sort((i1, i2) => arrWitnessNums[i2] - arrWitnessNums[i1]);

            let patchMerged = null;
            for (let i of sortedDownTipIndexes) {
                const vertex = arrTips[i];

                // merge tips with max witnessed paths first
                const {patch, blockHeader} = this._dagPendingBlocks.readObj(vertex) || {};

                // this patch (block) already finial applied to storage, and removed from DAG
                if (!patch) continue;

                try {
                    if (!patchMerged) {

                        // no need to merge first patch with empty. just store it
                        patchMerged = patch;
                    } else {
                        patchMerged = patchMerged.merge(patch);
                    }
                    arrParents.push(vertex);
                    mci = blockHeader.mci !== undefined && mci > blockHeader.mci ? mci : blockHeader.mci + 1;
                } catch (e) {

                    // TODO: rework it. this implementation (merging most witnessed vertex with other) could be non optimal
                }
            }

            return {

                // TODO: review this condition
                arrParents: arrParents.length ? arrParents : [Constants.GENEZIS_BLOCK],
                mci,
                patchMerged
            };
        }

    };
};
