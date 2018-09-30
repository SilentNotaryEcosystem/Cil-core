'use strict';
const typeforce = require('typeforce');
const EventEmitter = require('events');
const Tick = require('tick-tock');
const debug = require('debug')('bft:app');

const types = require('../types');

module.exports = (factory) => {
    const {Constants, Crypto, Messages} = factory;
    const {MsgWitnessNextRound, MsgWitnessCommon, MsgWitnessBlockVote} = Messages;
    const States = Constants.consensusStates;
    const MAIN_TIMER_NAME = 'stateChange';
    const Timeouts = Constants.consensusTimeouts;

    /**
     * Emits:
     * -
     */
    return class BftConsensus extends EventEmitter {
        /**
         *
         * @param {String} options.group
         * @param {Array} options.arrPublicKeys
         * @param {Wallet} options.wallet
         */
        constructor(options) {
            super();
            const {groupDefinition, wallet} = options;

            // TODO: implement network time (localtime + average network offset, calculated during handshake) it should be updated by Node?
            this._networkOffset = 0;

            this._nonce = parseInt(Math.random() * 100000);

            if (!groupDefinition) throw new Error('Use group definition to construct');
            this._groupDefinition = groupDefinition;

            if (!wallet) throw new Error('Specify wallet');
            this._wallet = wallet;

            // public keys are buffers, transform it to strings, to use with maps
            this._arrPublicKeys = groupDefinition.getPublicKeys().sort().map(key => key.toString('hex'));

            this._state = States.ROUND_CHANGE;
            this._roundFromNetworkTime();

            this._tock = new Tick(this);
            this._tock.setInterval(MAIN_TIMER_NAME, this._stateChange.bind(this), Timeouts.INIT);

            this._resetState();

            this._lastBlockTime = Date.now();
        }

        get groupName() {
            return this._groupDefinition.getGroupName();
        }

        get groupId() {
            return this._groupDefinition.getGroupId();
        }

//        get quorum() {
//            return this._quorum;
//        }

        /**
         * Check whether this public key belongs to our group
         *
         * @param {Buffer | String} pubKey
         * @return {boolean}
         */
        checkPublicKey(pubKey) {
            if (Buffer.isBuffer(pubKey)) pubKey = pubKey.toString('hex');
            return this._arrPublicKeys.includes(pubKey);
        }

        processMessage(witnessMsg) {
            const senderPubKey = witnessMsg.publicKey;

            debug(`BFT "${this._nonce}" processing "${witnessMsg.message}". State: "${this._state}"`);

            let msgCommon;
            if (witnessMsg.isExpose()) {
                msgCommon = Messages.MsgWitnessWitnessExpose.extract(witnessMsg);
            } else {
                msgCommon = witnessMsg;
            }

            // get real message
            if (msgCommon.isNextRound()) {
                witnessMsg = new Messages.MsgWitnessNextRound(msgCommon);
            } else if (msgCommon.isWitnessBlockVote()) {
                witnessMsg = new Messages.MsgWitnessBlockVote(msgCommon);
            }

            const state = this._stateFromMessage(witnessMsg);

            // it make a sense after extracting message from MsgWitnessWitnessExpose
            const pubKeyI = witnessMsg.publicKey;

            // make sure that those guys from our group
            if (!this.checkPublicKey(senderPubKey) || !this.checkPublicKey(pubKeyI)) {
                throw new Error(`wrong public key for message ${witnessMsg.message}`);
            }

//            debug(`BFT "${this._nonce}" added "${senderPubKey}--${pubKeyI}" data ${witnessMsg.content}`);
            this._addViewOfNodeWithPubKey(senderPubKey, pubKeyI, {state, ...witnessMsg.content});
            const value = this.runConsensus();
            if (!value) return false;

            debug(`BFT "${this._nonce}" consensus REACHED! State: "${this._state}"`);
            this._resetState();
            this._stateChange(true, value);
        }

        /**
         * reset state
         *
         * @private
         */
        _resetState() {
            this._views = {};
            this._arrPublicKeys.forEach(publicKey => {

                // prepare empty array for data transmitted of publicKey
                this._views[publicKey] = {};
            });
        }

        /**
         * VERIFY SIGNATURE of dataI !!!
         *
         * @param {String} publicKey - who send us partial response of i neighbor
         * @param {String} pubKeyI - pubKey of i neighbor
         * @param {Object} dataI - object that send i neighbor to address node
         * @private
         */
        _addViewOfNodeWithPubKey(publicKey, pubKeyI, dataI) {
            publicKey = Buffer.isBuffer(publicKey) ? publicKey.toString('hex') : publicKey;
            pubKeyI = Buffer.isBuffer(pubKeyI) ? pubKeyI.toString('hex') : pubKeyI;

            this._views[publicKey][pubKeyI] = dataI;
        }

        /**
         * @return {Object|undefined} - consensus value
         */
        runConsensus() {

            // i'm a single node (for example Initial witness)
            if (this._arrPublicKeys.length === 1 &&
                this._arrPublicKeys[0] === this._wallet.publicKey) {
                return this._views[this._wallet.publicKey][this._wallet.publicKey];
            }

            const arrWitnessValues = this._arrPublicKeys.map(pubKeyI => {
                const arrDataWitnessI = this._witnessData(pubKeyI);
                return this._majority(arrDataWitnessI);
            });

            return this._majority(arrWitnessValues);
        }

        /**
         * Get all data we received from witness with pubKeyI @see _addViewOfNodeWithPubKey
         *
         * @param {String} pubKeyI
         * @private
         */
        _witnessData(pubKeyI) {
            return this._arrPublicKeys.map(pubKeyJ => {
                return this._views[pubKeyJ][pubKeyI];
            });
        }

        /**
         *
         * @param {Array} arrDataWitnessI - array of values to find majority
         * @private
         */
        _majority(arrDataWitnessI) {
            const objHashes = {};
            for (let data of arrDataWitnessI) {
                const hash = this._calcDataHash(data);
                if (typeof objHashes[hash] !== 'object') {

                    // new value found
                    objHashes[hash] = {
                        count: 1,
                        value: data
                    };
                } else {
                    objHashes[hash].count++;
                }
            }
            let majorityValue = undefined;
            const count = Object.keys(objHashes).reduce((maxCount, currentHash) => {
                if (objHashes[currentHash].count > maxCount) {
                    majorityValue = objHashes[currentHash].value;
                    return objHashes[currentHash].count;
                }
                return maxCount;
            }, 0);

            return count >= this._groupDefinition.getQuorum() ? majorityValue : undefined;
        }

        processValidBlock(block) {
            debug(`BFT "${this._nonce}". Received block with hash: ${block.hash()}. State ${this._state}`);
            if (this._state !== States.BLOCK) {
                logger.error(`Got block at wrong state: "${this._state}"`);
                return;
            }
            this._block = block;
            this._lastBlockTime = Date.now();
            this._blockStateHandler(true);

            const message = this._createBlockAcceptMessage(
                this._groupDefinition.getGroupName(),
                Buffer.from(block.hash(), 'hex')
            );
            this.emit('message', message);
        }

        invalidBlock() {
            debug(`BFT "${this._nonce}". Received INVALID block. State ${this._state}`);
            if (this._state !== States.BLOCK) {
                logger.error(`Got block at wrong state: "${this._state}"`);
                return;
            }
            this._block = undefined;
            this._blockStateHandler(false);

            const message = this._createBlockRejectMessage(this._groupDefinition.getGroupName());
            this.emit('message', message);
        }

        /**
         * Transfrm data to hash to make data comparable
         *
         * @param {Object} data
         * @return {String|undefined}
         * @private
         */
        _calcDataHash(data) {

            // TODO: it's not best method i suppose. But deepEqual is even worse?
            if (data === undefined) return undefined;

            let copyData;
            // remove signature (it will be present for MSG_WITNESS_BLOCK_ACK) it will make items unequal
            if (data.hasOwnProperty('signature')) {

                // make a copy, because we'll modify it
                copyData = Object.assign({}, data);
                copyData.signature = undefined;
            } else {
                copyData = data;
            }
            return Crypto.createHash(JSON.stringify(copyData));
        }

        _adjustTimer() {

            // if we didn't turn it off
            if (this._tock.timers) {
                debug(`BFT "${this._nonce}". Timer restated. State ${this._state}`);
                this._tock.adjust(MAIN_TIMER_NAME, Timeouts[this._state]);
            }
        }

        /**
         * Called when timer expires or directly called when consensus reached
         *
         * @param {boolean} isConsensus - whether it called manually when consensus reached
         * @param {Object | undefined} consensusValue - whether it called manually when consensus reached
         * @param {String} consensusValue.state - consensus state
         * @param {Buffer} consensusValue.data - value for that state
         * @private
         */
        _stateChange(isConsensus = false, consensusValue = undefined) {
            const prevState = this._state;
            if (isConsensus && consensusValue && consensusValue.state) {
                this._state = consensusValue.state;
                this._adjustTimer();
            }

            switch (this._state) {
                case States.ROUND_CHANGE:
                    this._roundChangeHandler(isConsensus, consensusValue);
                    break;
                case States.BLOCK:

                    // if we are here - timeout reached
                    this._blockStateHandler(false);
                    break;
                case States.VOTE_BLOCK:

                    // TODO: add signatures (of hash) of voted witnesses to block
                    this._voteStateHandler(isConsensus, consensusValue);
                    break;
                case States.COMMIT:

                    // timeout for commit is reached. it's desired behavior to allow slow nodes keep round sync
                    // TODO: this state also requires acknowledge, because for small block it speed up process
                    // TODO: and will let all node to process large blocks

                    this._nextRound();
                    break;
            }
            if (prevState !== this._state) {
                debug(
                    `BFT "${this._nonce}" STATE changed! prev: "${prevState}" new "${this._state}" Round: ${this._roundNo}`);
            }

            this._adjustTimer();
        }

        /**
         * If no consensus: try to get majority round, fail - this._roundFromNetworkTime()
         * Has consensus:
         * - adjust roundNo
         * - if it's my turn to propose block - emit 'createBlock' to witness
         * - advance to BLOCK state
         *
         * @param {boolean} isConsensus - whether it called after consensus, or by timeout
         * @param {Object} consensusValue - if isConsensus == true if will contain data
         * @param {Buffer} consensusValue.data - protobuff encoded round
         * @private
         */
        _roundChangeHandler(isConsensus, consensusValue) {
            if (!isConsensus) {

                // if there is no consensus - force all to use _roundFromNetworkTime
                this._roundFromNetworkTime();
                debug(`BFT "${this._nonce}" adjusting round to NETWORK time`);
                this._nextRound();
            } else {
                this._roundNo = consensusValue.roundNo;
                this._state = States.BLOCK;
                this._adjustTimer();

                if (this.shouldPublish()) {
                    debug(
                        `BFT "${this._nonce}" will create block! RoundNo: ${this._roundNo}`);
                    this.emit('createBlock');
                }
            }
        }

        /**
         * if isValid & block:
         * - advance to VOTE_BLOCK
         * else (!isValid): we didn't receive valid block and timeout reached (possibly dead proposer?)
         * - _nextRound
         *
         * @param {boolean} isValid -  whether it called after consensus, or by timeout
         * @private
         */
        _blockStateHandler(isValid = false) {
            if (isValid) {
                this._state = States.VOTE_BLOCK;
            } else {
                this._nextRound();
            }
        }

        /**
         * If no consensus: we didn't receive enough BlockAccept messages, and timeout reached
         * Has consensus & valid block:
         * - advance to COMMIT
         *
         * @param {boolean} isConsensus -  whether it called after consensus, or by timeout
         * @param {Object} consensusValue - if isConsensus == true if will contain data
         * @param {Buffer} consensusValue.blockHash - block hash if VOTED for block || 'reject' if declined block
         * @private
         */
        _voteStateHandler(isConsensus, consensusValue) {
            if (isConsensus && consensusValue.blockHash + '' !== 'reject') {
                this._state = States.COMMIT;

                if (this._block) {
                    if (consensusValue.blockHash.equals(Buffer.from(this._block.hash(), 'hex'))) {
                        this.emit('commitBlock', this._block);
                    } else {

                        // Proposer misbehave!! sent us different block than other!
                        logger.error(`Proposer (pubkey "${this._getProposerKey()}") misbehave. Sent different blocks!`);
                    }
                }

                // if we missed block (!this._block i.e. late join to consensus) just wait a timeout to keep synced
            } else {

                // no consensus or all witnesses send MSG_WITNESS_BLOCK_REJECT
                this._nextRound();
            }

        }

        /**
         * Change current state to ROUND_CHANGE
         * Emit MsgWitnessNextRound to Witness (it will multicast it)
         * Check whether this my vote make form a consensus
         *
         * @private
         */
        _nextRound() {
            this._block = undefined;
            this._state = States.ROUND_CHANGE;

            debug(
                `BFT "${this._nonce}" restarting "ROUND_CHANGE" new round: ${this._roundNo}`);

            const msg = new MsgWitnessNextRound({groupName: this.groupName, roundNo: ++this._roundNo});
            msg.sign(this._wallet.privateKey);
            this.emit('message', msg);
        }

        /**
         * let's choose one, that should be same for all connected peers.
         * All peers that ahead or behind us more than Constants.networkTimeDiff will be banned
         *
         * @private
         */
        _roundFromNetworkTime() {
            const networkNow = this._getNetworkTime();
            this._roundNo = parseInt(networkNow / Constants.networkTimeDiff);
        }

        /**
         * Whether it's turn of 'proposer' to propose block?
         * Now implemented round-robin, replace if needed
         *
         * @param {String} proposer - publicKey of proposer
         * @return {boolean}
         */
        shouldPublish(proposer = this._wallet.publicKey) {
            return this._getProposerKey() === proposer;
        }

        /**
         * Redefine this to change proposing behavior
         *
         * @returns {*}
         * @private
         */
        _getProposerKey() {
            const idx = this._roundNo % this._arrPublicKeys.length;
            return this._arrPublicKeys[idx];
        }

        timeForWitnessBlock() {
            return Date.now() - this._lastBlockTime > Constants.WITNESS_HOLDOFF;
        }

        /**
         * Adjusted network time
         *
         * @return {number}
         * @private
         */
        _getNetworkTime() {
            return Date.now() + this._networkOffset;
        }

        _stateFromMessage(msg) {
            if (msg.isWitnessBlockVote()) return States.VOTE_BLOCK;
            if (msg.isNextRound()) return States.ROUND_CHANGE;
        }

        /**
         * For unit tests we don't need timer. This will turn it off
         *
         * @private
         */
        _stopTimer() {
            this._tock.end();
        }

        _createBlockAcceptMessage(groupName, blockHash) {
            typeforce(typeforce.tuple('String', typeforce.BufferN(32)), arguments);

            const msgBlockAccept = new MsgWitnessBlockVote({groupName, blockHash});
            msgBlockAccept.sign(this._wallet.privateKey);
            return msgBlockAccept;
        }

        _createBlockRejectMessage(groupName) {
            const msgBlockReject = MsgWitnessBlockVote.reject(groupName);
            msgBlockReject.sign(this._wallet.privateKey);
            return msgBlockReject;
        }

    };
};
