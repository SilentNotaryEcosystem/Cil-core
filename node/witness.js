const assert = require('assert');
const debugLib = require('debug');

const {createPeerTag, arrayEquals, ExceptionDebug} = require('../utils');

const debugWitness = debugLib('witness:app');
const debugWitnessMsg = debugLib('witness:messages');

module.exports = (factory, factoryOptions) => {
    const {Node, Messages, Constants, BFT, Block, Transaction, BaseConciliumDefinition, PatchDB, BlockInfo} = factory;
    const {MsgWitnessCommon, MsgWitnessBlock, MsgWitnessWitnessExpose} = Messages;

    return class Witness extends Node {
        constructor(options) {

            // mix in factory (common for all instance) options
            options = {
                ...factoryOptions,
                ...options,
                walletSupport: true
            };

            super(options);

            this._conciliumSeed = 0;

            const {wallet, networkSuspended, suppressJoinTx} = options;
            this._bCreateJoinTx = !suppressJoinTx;
            this._wallet = wallet;
            if (!this._wallet) throw new Error('Pass wallet into witness');

            this._walletPromise = this._ensureWalletIndex();

            if (!networkSuspended) {

                // upgrade capabilities from regular Node to Witness
                this._listenPromise.then(() => {
                    this._myPeerInfo.addCapability(
                        {service: Constants.WITNESS, data: Buffer.from(wallet.address, 'hex')});
                    this._peerManager.on('witnessMessage', this._incomingWitnessMessage.bind(this));
                });
            }
            this._consensuses = new Map();
            this._nLowestConciliumId = undefined;

            this._storage.on('conciliumsChanged', this.restart.bind(this));
        }

        async bootstrap() {

            // try early initialization of consensus engines
            const arrConciliums = await this._storage.getConciliumsByAddress(this._wallet.address);

            this._createPseudoRandomSeed(await this._storage.getLastAppliedBlockHashes());

            for (let def of arrConciliums) {
                await this._createConsensusForConcilium(def);
            }
            await super.bootstrap();
        }

        ensureLoaded() {
            const promiseParent = super.ensureLoaded();
            return Promise.all([promiseParent, this._walletPromise]).catch(err => console.error(err));
        }

        /**
         * Establish connection for all conciliums which this witness listed (address in concilium definition)
         *
         * @return {Promise<void>}
         */
        async start() {
            let arrConciliums;

            try {
                this._bReconnectInProgress = true;
                this._nMinConnections = Constants.MIN_PEERS;

                arrConciliums = await this._storage.getConciliumsByAddress(this._wallet.address);

                const arrConciliumIds = arrConciliums.map(cConcilium => cConcilium.getConciliumId());
                this._mempool.setPreferredConciliums(arrConciliumIds);

                // this need only at very beginning when witness start without genesis. In this case
                const wasInitialized = this._consensuses.size;

                for (let def of arrConciliums) {
                    this._nMinConnections += def.getMembersCount();

                    if (!wasInitialized) await this._createConsensusForConcilium(def);
                    await this.startConcilium(def);
                }
            } finally {
                this._bReconnectInProgress = false;
            }

            return arrConciliums.length;
        }

        async restart() {
            const wasStarted = this._consensuses.size;

            if (wasStarted) {
                this._consensuses.forEach(bft => bft._stopTimer());
                this._consensuses = new Map();
                this._nLowestConciliumId = undefined;
                await this.start();
            }
        }

        /**
         * Establish connection with other witnesses in specified concilium
         *
         * @param {BaseConciliumDefinition} concilium
         * @return {Promise<void>}
         */
        async startConcilium(concilium) {
            const peers = await this._getConciliumPeers(concilium);
            for (let peer of peers) {
                try {
                    await this._connectWitness(peer, concilium);
                } catch (e) {
                    logger.error(e.message);
                }
            }
        }

        /**
         *
         * @param {Peer} peer
         * @param {BaseConciliumDefinition} concilium
         * @return {Promise<void>}
         * @private
         */
        async _connectWitness(peer, concilium) {

            // we already done with this neighbour
            if (peer.witnessLoadDone(concilium.getConciliumId())) return;

            debugWitness(`--------- "${this._debugAddress}" started WITNESS handshake with "${peer.address}" ----`);
            if (peer.disconnected) {
                await this._connectToPeer(peer);
                await peer.pushMessage(this._createMsgVersion());
                await peer.loaded();
            } else {
                debugWitness(`(address: "${this._debugAddress}") reusing connection to "${peer.address}"`);
            }

            if (!peer.disconnected) {

                if (!peer.witnessLoadDone(concilium.getConciliumId())) {

                    // to prove that it's real witness it should perform signed handshake
                    const handshakeMsg = this._createHandshakeMessage(concilium.getConciliumId());
                    debugWitnessMsg(
                        `(address: "${this._debugAddress}") sending SIGNED message "${handshakeMsg.message}" to "${peer.address}"`);
                    await peer.pushMessage(handshakeMsg);
                    await peer.witnessLoaded(concilium.getConciliumId());
                }

                if (peer.witnessLoadDone(concilium.getConciliumId())) {
                    debugWitness(`----- "${this._debugAddress}". WITNESS handshake with "${peer.address}" DONE ---`);
                } else {
                    debugWitness(`----- "${this._debugAddress}". WITNESS peer "${peer.address}" TIMED OUT ---`);
                }
            } else {
                debugWitness(`----- "${this._debugAddress}". WITNESS peer "${peer.address}" DISCONNECTED ---`);
            }

            // TODO: request mempool tx from neighbor with MSG_MEMPOOL (https://en.bitcoin.it/wiki/Protocol_documentation#mempool)
        }

        async _storeWitness(peer, nConciliumId) {

            // mark it for broadcast
            peer.addTag(createPeerTag(nConciliumId));

            // prevent witness disconnect by timer or bytes threshold
            peer.markAsPersistent();

            // overwrite this peer definition with freshest data
            await this._peerManager.addPeer(peer, true);
        }

        async _reconnectPeers() {
            if (this._bReconnectInProgress) return;

            await this.start();

            // after we connected as much witnesses as possible - reconnect to other peers if we still have slots
            await super._reconnectPeers();
        }

        /**
         *
         * @param {BaseConciliumDefinition} concilium
         * @returns {Promise<void>}
         * @private
         */
        async _createConsensusForConcilium(concilium) {
            const consensus = new BFT({
                concilium,
                wallet: this._wallet
            });
            consensus.setRoundSeed(this._conciliumSeed);
            this._setConsensusHandlers(consensus);
            this._consensuses.set(concilium.getConciliumId(), consensus);

            // this will help to use only this concilium for joinTx creation
            //
            if (this._nLowestConciliumId === undefined || this._nLowestConciliumId > concilium.getConciliumId()) {
                this._nLowestConciliumId = concilium.getConciliumId();
            }
        }

        /**
         *
         * @param {BaseConciliumDefinition} concilium
         * @return {Array} of Peers with capability WITNESS which belongs to concilium
         * @private
         */
        async _getConciliumPeers(concilium) {
            const arrConciliumAddresses = concilium.getAddresses(false, true);
            const arrPeers = this._peerManager
                .filterPeers({service: Constants.WITNESS}, true)
                .filter(peer => ~arrConciliumAddresses.findIndex(walletAddr => walletAddr === peer.witnessAddress));
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
                logger.error(e.message);
            }
        }

        /**
         *
         * @param {Peer} peer
         * @param {MsgWitnessCommon} messageWitness
         * @param {BFT} consensus
         * @return {Promise<void>}
         * @private
         */
        async _processHandshakeMessage(peer, messageWitness, consensus) {

            // check whether this witness belong to our concilium
            if (!consensus.checkAddresses(peer.witnessAddress)) {
                peer.ban();
                throw(`Witness: "${this._debugAddress}" this guy UNKNOWN!`);
            }

            if (!peer.witnessLoadDone(messageWitness.conciliumId)) {

                // we don't check version & self connection because it's done on previous step (node connection)
                const response = this._createHandshakeMessage(messageWitness.conciliumId);
                debugWitnessMsg(
                    `(address: "${this._debugAddress}") sending SIGNED "${response.message}" to "${peer.address}"`);
                await peer.pushMessage(response);
            }

            await this._storeWitness(peer, messageWitness.conciliumId);
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

            // check proposer
            if (consensus.shouldPublish(messageWitness.address)) {

                // this will advance us to VOTE_BLOCK state whether block valid or not!
                const msgBlock = new MsgWitnessBlock(messageWitness);
                const block = msgBlock.block;
                if (await this._storage.hasBlock(block.hash())) {
                    logger.error(`Block ${block.hash()} already known!`);
                    return;
                }

                const lock = await this._mutex.acquire(['blockExec']);
                try {

                    // check block without checking signatures
                    await this._verifyBlock(block, false);
                    await this._compareParents(block);
                    if (this._canExecuteBlock(block)) {
                        this._processedBlock = block;
                        const patch = await this._execBlock(block);
                        consensus.processValidBlock(block, patch);
                    } else {
                        throw new Error(`Block ${block.hash()} couldn't be executed right now!`);
                    }

                    // no _accept here, because this block should be voted before
                } catch (e) {
                    e.log();
                    consensus.invalidBlock();
                } finally {
                    this._mutex.release(lock);
                }
            } else {

                // we still wait for block from designated proposer or timer for BLOCK state will expire
                debugWitness(
                    `(address: "${this._debugAddress}") "${peer.address}" creates a block, but not his turn!`);
            }
        }

        async _compareParents(block) {
            const {arrParents} = await this._pendingBlocks.getBestParents(block.getConciliumId());

            if (!arrayEquals(block.parentHashes, arrParents)) {
                throw new ExceptionDebug(
                    'Will reject block because of different parents');
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

            // we'll believe here to conciliumId. we'll check signature in bft.processMessage, and if there is no such member in this conciliumId - will throw
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
                if (this._mutex.isLocked('commitBlock') || this._isInitialBlockLoading()) return;

                const lock = await this._mutex.acquire(['createBlock', 'blockExec']);

                try {
                    const {conciliumId} = consensus;
                    const {block, patch} = await this._createBlock(conciliumId);
                    if (block.isEmpty() &&
                        (!consensus.timeForWitnessBlock() ||
                         this._isBigTimeDiff(block) ||
                         !this._pendingBlocks.isReasonToWitness(block)
                        )
                    ) {
                        this._suppressedBlockHandler();
                    } else {
                        await this._broadcastBlock(conciliumId, block);
                        consensus.processValidBlock(block, patch);
                    }
                } catch (e) {
                    logger.error(e);
                } finally {
                    this._mutex.release(lock);
                }
            });

            consensus.on('commitBlock', async (block, patch) => {
                const lock = await this._mutex.acquire(['commitBlock']);
                let lockBlock;

                try {
                    if (await this._isBlockKnown(block.hash())) {
                        throw new Error(`"commitBlock": block ${block.hash()} already known!`);
                    }

                    const arrContracts = [...patch.getContracts()];
                    if (arrContracts.length) {

                        // we have contracts inside block - we should re-execute block to have proper variables inside block
                        await this._handleArrivedBlock(block);
                    } else if (!this._mutex.isLocked('blockReceived') && !this._isBlockExecuted(block.getHash())) {
                        lockBlock = await this._mutex.acquire(['blockReceived', block.getHash()]);

                        // block still hadn't received from more quick (that already commited & announced block) witness
                        // we have only moneys transfers, so we could use patch. this will speed up processing
                        if (!this._isBlockExecuted(block.getHash())) {
                            await this._storeBlockAndInfo(block, new BlockInfo(block.header));
                            await this._acceptBlock(block, patch);
                            await this._postAcceptBlock(block);
                        }

                        if (!this._networkSuspended) this._informNeighbors(block);
                    }
                    logger.log(
                        `Witness: "${this._debugAddress}" block "${block.hash()}" Round: ${consensus.getCurrentRound()} commited at ${new Date} `);
                    consensus.blockCommited();

                } catch (e) {
                    logger.error(e);
                } finally {
                    this._mutex.release(lock);
                    if (lockBlock) this._mutex.release(lockBlock);
                }
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
            if (consensusInstance) consensusInstance.processMessage(msg);
        }

        /**
         *
         * @param {Number} conciliumId - for which conciliumId we create block
         * @returns {Promise<{block, patch}>}
         * @private
         */
        async _createBlock(conciliumId) {
            const nStartTime = Date.now();
            const block = new Block(conciliumId);
            block.markAsBuilding();

            let arrParents;
            let patchMerged;

            try {
                ({arrParents, patchMerged} = await this._pendingBlocks.getBestParents(conciliumId));
                patchMerged = patchMerged ? patchMerged : new PatchDB();
                patchMerged.setConciliumId(conciliumId);

                assert(Array.isArray(arrParents) && arrParents.length, 'Couldn\'t get parents for block!');
                block.parentHashes = arrParents;
                block.setHeight(this._calcHeight(arrParents));

                // variables for contracts (dummies)
                this._processedBlock = block;

                const arrBadHashes = [];
                let totalFee = 0;

                let arrTxToProcess=this._gatherTxns(conciliumId);
                if (this._bCreateJoinTx){
                    const arrUtxos = await this._storage.walletListUnspent(this._wallet.address);

                    // There is possible situation with 1 UTXO having numerous output. It will be count as 1
                    if (this._nLowestConciliumId === conciliumId && arrUtxos.length >
                        Constants.WITNESS_UTXOS_JOIN) {
                        arrTxToProcess.unshift(
                            this._createJoinTx(arrUtxos, conciliumId, Constants.MAX_UTXO_PER_TX / 2),
                        );
                    }
                }

                for (let tx of arrTxToProcess) {
                    try {

                        // with current timers and diameter if concilium more than 10 -
                        // TXns with 1000+ inputs will freeze network.
                        // So we'll skip this TXns
                        if (tx.inputs.length > Constants.MAX_UTXO_PER_TX) continue;
                        const {fee, patchThisTx} = await this._processTx(patchMerged, false, tx);

                        totalFee += fee;
                        patchMerged = patchMerged.merge(patchThisTx, true);
                        block.addTx(tx);

                        // this tx exceeded time limit for block creations - so we don't include it
                        if (Date.now() - nStartTime > Constants.BLOCK_CREATION_TIME_LIMIT) break;
                    } catch (e) {
                        logger.error(e);
                        arrBadHashes.push(tx.hash());
                    }
                }

                // remove failed txns
                if (arrBadHashes.length) this._mempool.removeTxns(arrBadHashes);

                block.finish(totalFee, this._wallet.address, await this._getFeeSizePerInput(conciliumId));
                await this._processBlockCoinbaseTX(block, totalFee, patchMerged);

                debugWitness(
                    `Witness: "${this._debugAddress}". Block ${block.hash()} with ${block.txns.length - 1} TXNs ready`);
            } catch (e) {
                logger.error(`Failed to create block!`, e);
            } finally {
                this._processedBlock = undefined;
            }

            return {block, patch: patchMerged};
        }

        _gatherTxns(conciliumId){
            const arrTxToProcess = this._mempool.getFinalTxns(conciliumId);

            // regular txns first
            return arrTxToProcess.sort((txA, txB) =>{
                const bIsTxAContract=txA.isContract();
                if(bIsTxAContract && txB.isContract()) {
                    return 0;
                }else if(bIsTxAContract){
                    return 1;
                }
                return -1;
            });
        }

        _createPseudoRandomSeed(arrLastStableBlockHashes) {
            this._conciliumSeed = super._createPseudoRandomSeed(arrLastStableBlockHashes);
            this._consensuses.forEach(c => c.setRoundSeed(this._conciliumSeed));
        };

        /**
         *
         * @param {Block} block
         * @return {boolean} - true, if at least one of a child is quite old.
         * @private
         */
        _isBigTimeDiff(block) {
            try {
                const arrTimeStamps = block.parentHashes.map(
                    strParentHash => this._pendingBlocks.getBlock(strParentHash).blockHeader.timestamp);

                return !arrTimeStamps.every(timestamp =>
                    block.timestamp - timestamp < Constants.BLOCK_AUTO_WITNESSING_TIMESTAMP_DIFF);
            } catch (e) {
                logger.error(e);
                return true;
            }
        }

        /**
         *
         * @param {Array} arrUtxos
         * @param {Number} nConciliumId
         * @param {Number} nMaxInputs
         * @return {*}
         * @private
         */
        _createJoinTx(arrUtxos, nConciliumId, nMaxInputs = Constants.MAX_UTXO_PER_TX / 2) {
            const tx = new Transaction();
            tx.conciliumId = nConciliumId;
            let nInputs = 0;
            let nTotalAmount = 0;

            for (let utxo of arrUtxos) {
                nTotalAmount += utxo.amountOut();
                for (let idx of utxo.getIndexes()) {
                    tx.addInput(utxo.getTxHash(), idx);
                    if (++nInputs >= nMaxInputs) break;
                }
                if (nInputs >= nMaxInputs) break;
            }

            const fee = (1 + nInputs) * Math.round(Constants.fees.TX_FEE * 0.12);
            tx.addReceiver(nTotalAmount - fee, Buffer.from(this._wallet.address, 'hex'));

            if (tx.inputs.length > 1) {
                tx.signForContract(this._wallet.privateKey);
            } else {
                for (let i in tx.inputs) {
                    tx.claim(parseInt(i), this._wallet.privateKey);
                }
            }

            logger.debug(`Created TX with ${tx.inputs.length} inputs`);

            return tx;
        }

        async _ensureWalletIndex() {
            try {
                await this._storage.walletWatchAddress(this._wallet.address);
            } catch (e) {}
            await this._storage.walletReIndex();
        }
    };
};
