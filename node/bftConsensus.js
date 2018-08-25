'use strict';
const EventEmitter = require('events');
const Tick = require('tick-tock');
const debug = require('debug')('bft:app');

module.exports = (Constants, Crypto, Messages) => {
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
            const {groupName, arrPublicKeys, wallet} = options;

            // TODO: implement network time (localtime + average network offset, calculated during handshake) it should be updated by Node?
            this._networkOffset = 0;

            this._nonce = parseInt(Math.random() * 100000);

            if (!groupName) throw new Error('Specify group name');
            this._groupName = groupName;

            if (!wallet) throw new Error('Specify wallet');
            this._wallet = wallet;

            if (!arrPublicKeys) throw new Error('Specify arrPublicKeys');
            this._arrPublicKeys = arrPublicKeys.sort();
            this._quorum = parseInt(arrPublicKeys.length / 2) + 1;

            this._state = States.INIT;
            this._roundFromNetworkTime();

            this._tock = new Tick(this);
            this._tock.setInterval(MAIN_TIMER_NAME, this._stateChange.bind(this), Timeouts.INIT);

            this._resetState();
        }

        get groupName() {
            return this._groupName;
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

            if (witnessMsg.isExpose()) {
                const msgCommon = Messages.MsgWitnessWitnessExpose.extract(witnessMsg);
                if (msgCommon.isNextRound()) witnessMsg = new Messages.MsgWitnessNextRound(msgCommon);
            }

            // it make a sense after extracting message from MsgWitnessWitnessExpose
            const pubKeyI = witnessMsg.publicKey;
            if (!this.checkPublicKey(senderPubKey) || !this.checkPublicKey(pubKeyI)) {
                throw new Error(`wrong public key for message ${witnessMsg.message}`);
            }

//            debug(`BFT "${this._nonce}" added "${senderPubKey}--${pubKeyI}" data ${witnessMsg.content}`);
            this._addViewOfNodeWithPubKey(senderPubKey, pubKeyI, witnessMsg.content);
            const value = this.runConsensus();
            if (!value) return false;

            debug(`BFT "${this._nonce}" consensus REACHED! State: "${this._state}"`);
            this._resetState();
            this._stateChange(true, value);
            return false;
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
            if (this._state !== States.BLOCK) {
                logger.error(`Got block at wrong state: "${this._state}"`);
                return;
            }
            this._block = block;

            // add my own ack to this block
            this._addViewOfNodeWithPubKey(this._wallet.publicKey, this._wallet.publicKey, Buffer.from(this._groupName));
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
         * @param {Buffer} consensusValue - whether it called manually when consensus reached
         * @private
         */
        _stateChange(isConsensus = false, consensusValue = undefined) {
            const prevState = this._state;
            switch (this._state) {
                case States.INIT:
                    this._initStateHandler(isConsensus, consensusValue);
                    break;
                case States.ROUND_CHANGE:
                    this._roundChangeHandler(isConsensus, consensusValue);
                    break;
                case States.BLOCK:

                    // Block handled by Witness.
                    this._blockStateHandler(isConsensus);
                    break;
                case States.PRE_VOTE_BLOCK:
                    this._prevoteStateHandler(isConsensus);
                    break;
                case States.PRE_COMMIT:
                    this._preCommitStateHandler(isConsensus, consensusValue);
                    break;
                case States.COMMIT:
                    this._commitStateHandler(isConsensus, consensusValue);
                    break;
            }
            if (prevState !== this._state) {
                debug(
                    `BFT "${this._nonce}" STATE changed! prev: "${prevState}" new "${this._state}" Round: ${this._roundNo}`);
            }

            this._adjustTimer();
        }

        /**
         * I'm just started up
         * If there is a consensus without me, just join it:
         * - set _roundNo
         * - go directly to BLOCK state
         * If no (INIT timer expires): start milticasting MsgWitnessNextRound
         *
         * @param {boolean} isConsensus - whether it called after consensus, or by timeout
         * @param {Buffer} consensusValue - if isConsensus == true if will contain data
         * @private
         */
        _initStateHandler(isConsensus, consensusValue) {
            if (isConsensus) {

                // adjust my roundNo from consensus reached without me (since i'm at INIT state)
                this._roundNo = this._roundFromConsensusValue(consensusValue);
                this._state = States.BLOCK;
            } else {

                // am i alone? start broadcasting my roundNo
                this._nextRound();
            }
        }

        /**
         * If no consensus: try to get majority round, fail - this._roundFromNetworkTime()
         * Has consensus:
         * - adjust roundNo
         * - if it's my turn to propose block - emit 'createBlock' to witness
         * - advance to BLOCK state
         *
         * @param {boolean} isConsensus - whether it called after consensus, or by timeout
         * @param {Buffer} consensusValue - if isConsensus == true if will contain data
         * @private
         */
        _roundChangeHandler(isConsensus, consensusValue) {
            if (!isConsensus) {
                this._tryToAdjustRound();
                this._nextRound();
            } else {
                this._roundNo = this._roundFromConsensusValue(consensusValue);
                this._state = States.BLOCK;
                this._adjustTimer();

                if (this.shouldPublish()) this.emit('createBlock');
            }
        }

        /**
         * If no consensus: we didn't receive enough BlockAck messages, and timeout reached
         * Has consensus & valid block:
         * - advance to PRE_VOTE_BLOCK
         *
         * @param {boolean} isConsensus -  whether it called after consensus, or by timeout
         * @private
         */
        _blockStateHandler(isConsensus) {
            if (isConsensus && this._block) {
                this._state = States.PRE_VOTE_BLOCK;
            } else {
                this._nextRound();
            }
        }

        /**
         *
         * @param {boolean} isConsensus -  whether it called after consensus, or by timeout
         * @private
         */
        _prevoteStateHandler(isConsensus) {
            if (isConsensus) {
                this._state = States.PRE_COMMIT;
            } else {
                this._nextRound();
            }

        }

        /**
         *
         * @param {boolean} isConsensus - whether it called after consensus, or by timeout
         * @param {Buffer} consensusValue - if isConsensus == true if will contain data
         * @private
         */
        _preCommitStateHandler(isConsensus, consensusValue) {

            // TODO: implement!
            if (isConsensus) {
                this._state = States.COMMIT;
            } else {
                this._nextRound();
            }

        }

        /**
         *
         * @param {boolean} isConsensus - whether it called after consensus, or by timeout
         * @param {Buffer} consensusValue - if isConsensus == true if will contain data
         * @private
         */
        _commitStateHandler(isConsensus, consensusValue) {
            // TODO: implement!
            this._nextRound();
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
            this._resetState();

            const msg = new MsgWitnessNextRound({groupName: this.groupName, roundNo: ++this._roundNo});
            msg.sign(this._wallet.privateKey);

            debug(
                `BFT "${this._nonce}" restarting "ROUND_CHANGE" new round: ${this._roundNo}`);
            this.emit('message', msg);

            debug(
                `BFT "${this._nonce}" processing own data: ${msg.content}`);

            // Check whether this my vote make form a consensus
            this.processMessage(msg);
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
                const msgNextRound = new MsgWitnessNextRound({groupName: this._groupName, roundNo: 1});
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

        /**
         * Adjusted network time
         *
         * @return {number}
         * @private
         */
        _getNetworkTime() {
            return Date.now() + this._networkOffset;
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
