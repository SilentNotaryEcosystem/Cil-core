'use strict';
const assert = require('assert');
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
         * @param {String} options.concilium
         * @param {Wallet} options.wallet
         */
        constructor(options) {
            super();
            const {concilium, wallet, aggressiveWitnessing} = options;

            this._aggressiveWitnessing = aggressiveWitnessing;

            this._networkOffset = 0;

            this._nonce = parseInt(Math.random() * 100000);

            if (!concilium) throw new Error('Use concilium definition to construct');
            this._concilium = concilium;

            if (!wallet) throw new Error('Specify wallet');
            this._wallet = wallet;

            this._arrAddresses = concilium.getAddresses().sort().map(addr => addr.toString('hex'));

            this._state = States.ROUND_CHANGE;
            this._concilium.initRounds();

            this._tock = new Tick(this);
            this._tock.setInterval(MAIN_TIMER_NAME, this._stateChange.bind(this), Timeouts.INIT);

            this._resetState();

            this._lastBlockTime = Date.now();
        }

        get conciliumId() {
            return this._concilium.getConciliumId();
        }

        updateNetworkTime(nNewOffset) {
            this._networkOffset = nNewOffset;
        }

//        get quorum() {
//            return this._quorum;
//        }

        /**
         * Check whether this address belongs to our concilium
         *
         * @param {Buffer | String} address
         * @return {boolean}
         */
        checkAddresses(address) {
            if (Buffer.isBuffer(address)) address = address.toString('hex');
            return this._arrAddresses.includes(address);
        }

        processMessage(witnessMsg) {
            const senderAddr = witnessMsg.address;

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
            const addrI = witnessMsg.address;

            // make sure that those guys from our concilium
            // if ok - this means message wasn't changed
            if (!this.checkAddresses(senderAddr) || !this.checkAddresses(addrI)) {
                throw new Error(`Message ${witnessMsg.message} from wrong address`);
            }

            debug(
                `BFT "${this._nonce}" added "${senderAddr}--${addrI}" data ${JSON.stringify(witnessMsg.content)}`);
            this._addViewOfNodeWithAddr(senderAddr, addrI, {state, ...witnessMsg.content});
            const value = this.runConsensus();
            if (!value) return false;

            debug(`BFT "${this._nonce}" consensus REACHED! State: "${this._state}"`);

            // TODO: add mutex here?
            this._resetState();
            this._stateChange(true, value);
        }

        /**
         * reset state
         *
         * @private
         */
        _resetState() {
            this._prevViews = this._views;
            this._views = {};
            this._arrAddresses.forEach(addr => {

                // prepare empty array for data transmitted from addr
                this._views[addr] = {};
            });
        }

        /**
         * We could be sure that dataI was unchanged, because we recover address (pubKey) from that message
         * And it match one of our witnesses.
         * In case of dataI modification we'll recover some key that wouldn't match key of any our witnesses
         *
         * @param {String} addr - who send us response of i-neighbor
         * @param {String} addrI - address of i-neighbor
         * @param {Object} dataI - object that send i-neighbor to witness with @addr
         * @private
         */
        _addViewOfNodeWithAddr(addr, addrI, dataI) {
            addr = Buffer.isBuffer(addr) ? addr.toString('hex') : addr;
            addrI = Buffer.isBuffer(addrI) ? addrI.toString('hex') : addrI;

            this._views[addr][addrI] = dataI;
        }

        /**
         * @return {Object|undefined} - consensus value
         */
        runConsensus() {

            // i'm a single node (for example Initial witness)
            if (this._concilium.getQuorum() === 1 &&
                this._arrAddresses.includes(this._wallet.address)) {
                return this._views[this._wallet.address][this._wallet.address];
            }

            //
            const arrWitnessValues = this._arrAddresses.map(addrI => {
                const arrDataWitnessI = this._witnessData(addrI);
                return this._majority(arrDataWitnessI);
            });

            return this._majority(arrWitnessValues);
        }

        /**
         * Get all data we received from witness with addrI @see _addViewOfNodeWithAddr
         * I.e. what data it saw from neighbours
         *
         * @param {String} addrI
         * @param {Boolean} usingCurrentView - do we using current view, or previous (used for signatures gathering) on VOTE stage
         * @returns {Array} of data we received from witness with addrI
         * @private
         */
        _witnessData(addrI, usingCurrentView = true) {
            const views = usingCurrentView ? this._views : this._prevViews;
            assert(views, 'Unexpected views error');
            return this._arrAddresses.map(addrJ => {
                return views[addrJ][addrI];
            });
        }

        /**
         * Data from Array, that meets more than quorum times, or undefined (if data different)
         *
         * @param {Array} arrDataWitnessI - array of values to find majority
         * @returns {Object | undefined}
         * @private
         */
        _majority(arrDataWitnessI) {
            const objHashes = {};
            for (let j = 0; j < arrDataWitnessI.length; j++) {
                const data = arrDataWitnessI[j];
                if (data === undefined) continue;
                const hash = this._calcDataHash(data);

                const weight = this._concilium.getWitnessWeight(this._arrAddresses[j]);
                if (typeof objHashes[hash] !== 'object') {

                    // new value found
                    objHashes[hash] = {
                        count: weight,
                        value: data
                    };
                } else {
                    objHashes[hash].count += weight;
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
            return count >= this._concilium.getQuorum() ? majorityValue : undefined;
        }

        /**
         * - Store block for further processing
         * - advance state to Vote
         * - send it to other witnesses
         *
         * @param {Block} block
         */
        processValidBlock(block) {
            typeforce(types.Block, block);

            debug(`BFT "${this._nonce}". Received block with hash: ${block.hash()}. State ${this._state}`);
            if (this._state !== States.BLOCK) {
                logger.error(`Got block at wrong state: "${this._state}"`);
                return;
            }
            this._block = block;
            this._lastBlockTime = Date.now();
            this._blockStateHandler(true);

            const message = this._createBlockAcceptMessage(
                this._concilium.getConciliumId(),
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

            const message = this._createBlockRejectMessage(this._concilium.getConciliumId());
            this.emit('message', message);
        }

        blockCommited() {
            // TODO: this state (COMMIT) also requires acknowledge, because for small block it speed up process
            //  and will let all node to process large blocks
        }

        /**
         * Transform data to hash to make data comparable
         *
         * @param {Object} data
         * @return {String|undefined}
         * @private
         */
        _calcDataHash(data) {
            let copyData;

            // remove signature (it will be present for MSG_WITNESS_BLOCK_ACK) it will make items unequal
            if (data.hasOwnProperty('signature')) {

                // make a copy, because we'll modify it
                // we don't care about deep cloning becuase we'll modify only signature
                copyData = Object.assign({}, data);
                copyData.signature = undefined;
            } else {
                copyData = data;
            }

            // TODO: it's not best method i suppose. But deepEqual is even worse?
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
                    this._voteStateHandler(isConsensus, consensusValue);
                    break;
                case States.COMMIT:
                    this._nextRound();
                    break;
            }
            if (prevState !== this._state) {
                debug(
                    `BFT "${this._nonce}" STATE changed! prev: "${prevState}" new "${this._state}" Round: ${this._concilium.getRound()}`);
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
                debug(`BFT "${this._nonce}" round failed`);
                this._nextRound();
            } else {
                this._state = States.BLOCK;
                this._adjustTimer();

                if (this.shouldPublish()) {
                    debug(
                        `BFT "${this._nonce}" will create block! RoundNo: ${this._concilium.getRound()}`);
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
                        const arrSignatures = this._getSignaturesForBlock();

                        if (!arrSignatures || !arrSignatures.length) {
                            logger.error(
                                `Consensus reached for block ${consensusValue.blockHash}, but fail to get signatures!`);
                            return this._nextRound();
                        }

                        this._block.addWitnessSignatures(arrSignatures);
                        this.emit('commitBlock', this._block);
                    } else {

                        // Proposer misbehave!! sent us different block than other!
                        logger.error(`Proposer (address "${
                            this._concilium.getProposerAddress(
                                this._concilium.getRound())}") misbehave. Sent different blocks!`);
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
                `BFT "${this._nonce}" restarting "ROUND_CHANGE" new round: ${this._concilium.getRound()}`);

            const msg = new MsgWitnessNextRound({conciliumId: this.conciliumId, roundNo: this._concilium.nextRound()});
            msg.sign(this._wallet.privateKey);
            this.emit('message', msg);
        }

        /**
         * Whether it's turn of 'proposer' to propose block?
         *
         * @param {String} proposer - address of proposer
         * @return {boolean}
         */
        shouldPublish(proposer = this._wallet.address) {
            return this._concilium.getProposerAddress(this._concilium.getRound()) === proposer;
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

        _createBlockAcceptMessage(conciliumId, blockHash) {
            typeforce(typeforce.tuple('Number', typeforce.BufferN(32)), arguments);

            const msgBlockAccept = new MsgWitnessBlockVote({conciliumId, blockHash});
            msgBlockAccept.sign(this._wallet.privateKey);
            return msgBlockAccept;
        }

        _createBlockRejectMessage(conciliumId) {
            const msgBlockReject = MsgWitnessBlockVote.reject(conciliumId);
            msgBlockReject.sign(this._wallet.privateKey);
            return msgBlockReject;
        }

        /**
         * Get block hash signatures from state (this._views contains {state, blockHash, signature})
         * and return it to append to block
         *
         * @returns {Array}
         * @private
         */
        _getSignaturesForBlock() {
            if (!this._block) throw new Error('No block stored!');
            const buffBlockHash = Buffer.from(this._block.hash(), 'hex');

            const arrSignatures = [];
            let gatheredWeight = 0;
            this._arrAddresses.forEach(addrI => {
                const arrDataWitnessI = this._witnessData(addrI, false);
                const votedValue = this._majority(arrDataWitnessI);

                if (votedValue
                    && Buffer.isBuffer(votedValue.blockHash)
                    && votedValue.blockHash.equals(buffBlockHash)
                    && votedValue.signature
                    && addrI === Crypto.getAddress(Crypto.recoverPubKey(buffBlockHash, votedValue.signature))
                ) {

                    // this will suppress empty elements in result array
                    arrSignatures.push(votedValue.signature);
                    gatheredWeight += this._concilium.getWitnessWeight(addrI);
                }
            });
            const quorum = this._concilium.getQuorum();

            assert(quorum, `Quorum couldn't be zero!`);

            return gatheredWeight >= quorum ? arrSignatures : undefined;
        }
    };
};
