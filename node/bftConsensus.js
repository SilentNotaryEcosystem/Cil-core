'use strict';
const EventEmitter = require('events');
const Tick = require('tick-tock');
const debug = require('debug')('bft:app');

module.exports = (factory) => {
    const {Constants, Crypto, Messages} = factory;
    const {MsgWitnessNextRound} = Messages;
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
            this._quorum = parseInt(this._arrPublicKeys.length / 2) + 1;

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

            if (witnessMsg.isExpose()) {
                const msgCommon = Messages.MsgWitnessWitnessExpose.extract(witnessMsg);
                if (msgCommon.isNextRound()) witnessMsg = new Messages.MsgWitnessNextRound(msgCommon);
                if (msgCommon.isWitnessBlockAccept() ||
                    msgCommon.isWitnessBlockReject()) {
                    witnessMsg = new Messages.MsgWitnessCommon(msgCommon);
                }
            }

            const state = this._stateFromMessage(witnessMsg);

            // it make a sense after extracting message from MsgWitnessWitnessExpose
            const pubKeyI = witnessMsg.publicKey;
            if (!this.checkPublicKey(senderPubKey) || !this.checkPublicKey(pubKeyI)) {
                throw new Error(`wrong public key for message ${witnessMsg.message}`);
            }

//            debug(`BFT "${this._nonce}" added "${senderPubKey}--${pubKeyI}" data ${witnessMsg.content}`);
            this._addViewOfNodeWithPubKey(senderPubKey, pubKeyI, {state, data: witnessMsg.content});
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
         * @param {boolean} weak - we need just value that has most witnesses, used to adjust initial state
         * @return {Object|undefined} - consensus value
         */
        runConsensus({weak} = {weak: false}) {

            // i'm a single node (for example Initial witness)
            if (this._arrPublicKeys.length === 1 &&
                this._arrPublicKeys[0] === this._wallet.publicKey) {
                return this._views[this._wallet.publicKey][this._wallet.publicKey];
            }

            const arrWitnessValues = this._arrPublicKeys.map(pubKeyI => {

                // Let's get data of I witness
                const arrDataWitnessI = this._arrPublicKeys.map(pubKeyJ => {
                    return this._views[pubKeyJ][pubKeyI];
                });
                return this._majority(arrDataWitnessI, weak);
            });

            return this._majority(arrWitnessValues, weak);
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
        }

        invalidBlock() {
            debug(`BFT "${this._nonce}". Received INVALID block. State ${this._state}`);
            if (this._state !== States.BLOCK) {
                logger.error(`Got block at wrong state: "${this._state}"`);
                return;
            }
            this._block = undefined;
            this._blockStateHandler(false);
        }

        /**
         *
         * @param {Array} arrDataWitnessI - array of values to find majority
         * @param {boolean} weak - we need just max value
         * @private
         */
        _majority(arrDataWitnessI, weak = false) {
            const objHashes = {};
            for (let data of arrDataWitnessI) {
                const hash = this._calcDataHash(data);
                if (typeof objHashes[hash] !== 'object') {
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

            if (weak) return count === 1 ? undefined : majorityValue;
            return count >= this._quorum ? majorityValue : undefined;
        }

        /**
         * Calculate hash of data to sum votes
         *
         * @param {Object} data
         * @return {String|undefined}
         * @private
         */
        _calcDataHash(data) {
            return data === undefined ? undefined : Crypto.sha256(JSON.stringify(data));
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
                this._tryToAdjustRound();
                this._nextRound();
            } else {
                this._roundNo = this._roundFromConsensusValue(consensusValue.data);
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
         * @param {Buffer} consensusValue.data - block hash if VOTED for block || 'reject' if declined block
         * @private
         */
        _voteStateHandler(isConsensus, consensusValue) {
            if (isConsensus && consensusValue.data + '' !== 'reject') {
                this._state = States.COMMIT;

                if (this._block) {
                    if (consensusValue.data + '' === this._block.hash()) {
                        this.emit('commitBlock', this._block);
                    } else {

                        // witness misbehave!! sent us different block than other!
                        // TODO: punish publisher!
                        const idx = this._roundNo % this._arrPublicKeys.length;
                        logger.error(`Witness with pubkey "${this._arrPublicKeys[idx]}" misbehave!`);
                    }
                }

                // if we missed block (!this._block i.e. late join to consensus) just wait a timeout to keep synced
            } else {
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
         * It will try get maximum roundNo from other group members, and we'll try to reach consensus with it
         *
         * @private
         */
        _tryToAdjustRound() {
            const value = this.runConsensus({weak: true});
            const roundNo = this._roundFromConsensusValue(value);
            if (roundNo !== undefined) {
                this._roundNo = roundNo;
            } else {

                // neither consensus nor weak consensus. all at their own roundNo
                this._roundFromNetworkTime();
                debug(`BFT "${this._nonce}" adjusting round to NETWORK time`);
            }
        }

        /**
         *
         * @param {Buffer} value - serialized
         * @return {Number | undefined} - roundNo parsed from value
         * @private
         */
        _roundFromConsensusValue(value) {
            let roundNo = undefined;
            if (value) {
                const msgNextRound = new MsgWitnessNextRound(
                    {groupName: this._groupDefinition.getGroupName(), roundNo: 1});
                try {
                    msgNextRound.parseContent(value);
                    roundNo = msgNextRound.roundNo;
                } catch (e) {}
            }
            return roundNo;
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
            const idx = this._roundNo % this._arrPublicKeys.length;
            return this._arrPublicKeys[idx] === proposer;
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
            if (msg.isWitnessBlockAccept() || msg.isWitnessBlockReject()) return States.VOTE_BLOCK;
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
    };
};
