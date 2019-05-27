const assert = require('assert');
const typeforce = require('typeforce');
const debugLib = require('debug');

const {sleep} = require('../utils');
const types = require('../types');

const debugWitness = debugLib('witness:app');
const debugWitnessMsg = debugLib('witness:messages');

const createPeerTag = (nConciliumId) => {
    return `wg${nConciliumId}`;
};

module.exports = (factory, factoryOptions) => {
    const {Node, Messages, Constants, BFT, Block, Transaction, ConciliumDefinition, PatchDB, BlockInfo} = factory;
    const {MsgWitnessCommon, MsgWitnessBlock, MsgWitnessWitnessExpose} = Messages;

    return class Witness extends Node {
        constructor(options) {

            // mix in factory (common for all instance) options
            options = {
                ...factoryOptions,
                ...options
            };

            super(options);

            const {wallet} = options;
            this._wallet = wallet;
            if (!this._wallet) throw new Error('Pass wallet into witness');

            // upgrade capabilities from regular Node to Witness
            this._listenPromise.then(() => {
                this._myPeerInfo.addCapability(
                    {service: Constants.WITNESS, data: Buffer.from(wallet.publicKey, 'hex')});
                this._peerManager.on('witnessMessage', this._incomingWitnessMessage.bind(this));
            });

            this._consensuses = new Map();
        }

        async bootstrap() {

            // try early initialization of consensus engines
            const arrConciliums = await this._storage.getConciliumsByKey(this._wallet.publicKey);

            for (let def of arrConciliums) {
                await this._createConsensusForConcilium(def);
            }
            await super.bootstrap();
        }

        /**
         * Establish connection for all conciliums which this witness listed (publicKey in concilium definition)
         *
         * @return {Promise<void>}
         */
        async start() {
            const arrConciliums = await this._storage.getConciliumsByKey(this._wallet.publicKey);

            // this need only at very beginning when witness start without genesis. In this case
            const wasInitialized = this._consensuses.size;

            for (let def of arrConciliums) {
                if (!wasInitialized) await this._createConsensusForConcilium(def);
                await this.startConcilium(def);
            }

            return arrConciliums.length;
            // TODO: add watchdog to maintain connections to as much as possible witnesses
        }

        /**
         * Establish connection with other witnesses in specified concilium
         *
         * @param {ConciliumDefinition} concilium
         * @return {Promise<void>}
         */
        async startConcilium(concilium) {
            const peers = await this._getConciliumPeers(concilium);
            debugWitness(
                `******* "${this._debugAddress}" started WITNESS for concilium: "${concilium.getConciliumId()}" ${peers.length} peers *******`);

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
                    const handshakeMsg = this._createHandshakeMessage(concilium.getConciliumId());
                    debugWitnessMsg(
                        `(address: "${this._debugAddress}") sending SIGNED message "${handshakeMsg.message}" to "${peer.address}"`);
                    await peer.pushMessage(handshakeMsg);
                    await Promise.race([peer.witnessLoaded(), sleep(Constants.PEER_QUERY_TIMEOUT)]);

                    if (peer.witnessLoadDone) {

                        // mark it for broadcast
                        peer.addTag(createPeerTag(concilium.getConciliumId()));

                        // prevent witness disconnect by timer or bytes threshold
                        peer.markAsPersistent();

                        // overwrite this peer definition with freshest data
                        await this._peerManager.addPeer(peer, true);
                        debugWitness(
                            `----- "${this._debugAddress}". WITNESS handshake with "${peer.address}" DONE ---`);
                    } else {
                        debugWitness(`----- "${this._debugAddress}". WITNESS peer "${peer.address}" TIMED OUT ---`);
                    }
                } else {
                    debugWitness(`----- "${this._debugAddress}". WITNESS peer "${peer.address}" DISCONNECTED ---`);
                }

                // TODO: request mempool tx from neighbor with MSG_MEMPOOL (https://en.bitcoin.it/wiki/Protocol_documentation#mempool)
            }
        }

        /**
         *
         * @param {ConciliumDefinition} concilium
         * @returns {Promise<void>}
         * @private
         */
        async _createConsensusForConcilium(concilium) {
            const consensus = new BFT({
                concilium,
                wallet: this._wallet
            });
            this._setConsensusHandlers(consensus);
            this._consensuses.set(concilium.getConciliumId(), consensus);
        }

        /**
         *
         * @param {ConciliumDefinition} concilium
         * @return {Array} of Peers with capability WITNESS which belongs to concilium
         * @private
         */
        async _getConciliumPeers(concilium) {
            const arrConciliumKeys = concilium.getPublicKeys();
            const arrAllWitnessesPeers = this._peerManager.filterPeers({service: Constants.WITNESS}, true);
            const arrPeers = [];
            for (let peer of arrAllWitnessesPeers) {
                if (~arrConciliumKeys.findIndex(key => {
                    const buffKey = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
                    return buffKey.equals(peer.publicKey);
                })) {
                    arrPeers.push(peer);
                }
            }
            return arrPeers;
        }

        async _incomingWitnessMessage(peer, message) {
            try {
                const messageWitness = this._checkPeerAndMessage(peer, message);
                const consensus = this._consensuses.get(messageWitness.conciliumId);

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
                debugWitness(`(address: "${this._debugAddress}") sending data to BFT: ${messageWitness.content.toString(
                    'hex')}`);
                consensus.processMessage(messageWitness);
            } catch (e) {
                logger.error(e);
            }
        }

        async _processHandshakeMessage(peer, messageWitness, consensus) {

            // check whether this witness belong to our concilium
            if (!consensus.checkPublicKey(peer.publicKey)) {
                peer.ban();
                throw(`Witness: "${this._debugAddress}" this guy UNKNOWN!`);
            }

            if (peer.inbound) {

                // prevent witness disconnect by timer or bytes threshold
                peer.markAsPersistent();

                // we don't check version & self connection because it's done on previous step (node connection)
                const response = this._createHandshakeMessage(messageWitness.conciliumId);
                debugWitnessMsg(
                    `(address: "${this._debugAddress}") sending SIGNED "${response.message}" to "${peer.address}"`);
                await peer.pushMessage(response);
                peer.addTag(createPeerTag(messageWitness.conciliumId));
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
                    if (await this._canExecuteBlock(block)) {
                        await this._execBlock(block);
                        consensus.processValidBlock(block);
                    } else {
                        throw new Error(`Block ${block.hash()} couldn't be executed right now!`);
                    }

                    // no _accept here, because this block should be voted before
                } catch (e) {
                    logger.error(e);
                    consensus.invalidBlock();
                }
            } else {

                // we still wait for block from designated proposer or timer for BLOCK state will expire
                debugWitness(
                    `(address: "${this._debugAddress}") "${peer.address}" creates a block, but not his turn!`);
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
            const consensus = this._consensuses.get(messageWitness.conciliumId);
            if (!consensus) {
                throw new Error(`Witness: "${this._debugAddress}" send us message for UNKNOWN CONCILIUM!`);
            }

            return messageWitness;
        }

        _adjustNetworkTime(offset) {
            super._adjustNetworkTime(offset);

            for (let [, consensus] of this._consensuses) {
                consensus.updateNetworkTime(this._msecOffset);
            }
        }

        _setConsensusHandlers(consensus) {
            consensus.on('message', message => {
                debugWitness(`Witness: "${this._debugAddress}" message "${message.message}" from CONSENSUS engine`);
                this._broadcastConsensusInitiatedMessage(message);
            });
            consensus.on('createBlock', async () => {
                const lock = await this._mutex.acquire(['createBlock']);

                try {
                    const {conciliumId} = consensus;
                    const {block} = await this._createBlock(conciliumId);
                    if (block.isEmpty() && !consensus.timeForWitnessBlock()) {

                        // catch it below
                        throw (0);
                    }

                    await this._broadcastBlock(conciliumId, block);

                    consensus.processValidBlock(block);
                } catch (e) {
                    if (typeof e === 'number') {
                        this._suppressedBlockHandler();
                    } else {
                        logger.error(e);
                    }
                } finally {
                    this._mutex.release(lock);
                }
            });
            consensus.on('commitBlock', async (block) => {
                await this._handleArrivedBlock(block);
                logger.log(
                    `Witness: "${this._debugAddress}" block "${block.hash()}" Round: ${consensus._roundNo} commited at ${new Date} `);
                consensus.blockCommited();
            });
        }

        /**
         *
         *
         * @private
         */
        _suppressedBlockHandler() {
            debugWitness(`(address: "${this._debugAddress}"). Suppressing empty block`);
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
        _createHandshakeMessage(conciliumId) {
            const msg = new MsgWitnessCommon({conciliumId});
            msg.handshakeMessage = true;
            msg.sign(this._wallet.privateKey);
            return msg;
        }

        /**
         * broadcast MSG_WITNESS_BLOCK to other witnesses
         *
         * @param {Number} conciliumId
         * @param {Block} block
         * @returns {Promise<*>}
         * @private
         */
        async _broadcastBlock(conciliumId, block) {
            const msg = new MsgWitnessBlock({conciliumId});

            msg.block = block;
            msg.sign(this._wallet.privateKey);

            this._peerManager.broadcastToConnected(createPeerTag(conciliumId), msg);
            debugWitness(`Witness: "${this._debugAddress}". Block ${block.hash()} broadcasted`);
        }

        _broadcastConsensusInitiatedMessage(msg) {
            const conciliumId = msg.conciliumId;
            this._peerManager.broadcastToConnected(createPeerTag(conciliumId), msg);
            const consensusInstance = this._consensuses.get(conciliumId);

            // set my own view
            consensusInstance.processMessage(msg);
        }

        /**
         *
         * @param {Number} conciliumId - for which conciliumId we create block
         * @returns {Promise<{block, patch}>}
         * @private
         */
        async _createBlock(conciliumId) {

            const block = new Block(conciliumId);
            let {arrParents, patchMerged} = await this._pendingBlocks.getBestParents();
            patchMerged = patchMerged ? patchMerged : new PatchDB();
            patchMerged.setConciliumId(conciliumId);

            assert(Array.isArray(arrParents) && arrParents.length, 'Couldn\'t get parents for block!');
            block.parentHashes = arrParents;
            block.setHeight(this._calcHeight(arrParents));

            const arrBadHashes = [];
            let totalFee = 0;
            for (let tx of this._mempool.getFinalTxns(conciliumId)) {
                try {
                    const {fee, patchThisTx} = await this._processTx(patchMerged, false, tx);
                    totalFee += fee;
                    patchMerged = patchMerged.merge(patchThisTx, true);
                    block.addTx(tx);
                } catch (e) {
                    logger.error(e);
                    arrBadHashes.push(tx.hash());
                }
            }

            // remove failed txns
            if (arrBadHashes.length) this._mempool.removeTxns(arrBadHashes);

            block.finish(totalFee, this._wallet.publicKey, await this._getFeeSizePerInput(conciliumId));

            debugWitness(
                `Witness: "${this._debugAddress}". Block ${block.hash()} with ${block.txns.length - 1} TXNs ready`);

            return {block};
        }
    };
};
