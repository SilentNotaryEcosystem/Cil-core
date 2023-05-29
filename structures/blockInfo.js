const typeforce = require('typeforce');
const types = require('../types');

// block awaits for parents to be executed
const IN_FLIGHT_BLOCK = 1 << 1;

// block executed successfully
const EXECUTED_BLOCK = 1 << 2;

// block processed and it's UTXO are stored in DB
const FINAL_BLOCK = 1 << 3;

// block cannot be executed (validation failed)
const BAD_BLOCK = 1 << 8;
// Class to store block header + additional info in DB
module.exports = ({Constants, Crypto}, {blockInfoProto, blockHeaderProto}) =>

    class BlockInfo {

        /**
         *
         * @param {Object | Buffer} data - block header or serialized data
         */
        constructor(data) {
            typeforce(typeforce.oneOf('Object', 'Buffer'), data);

            if (Buffer.isBuffer(data)) {
                this._data = blockInfoProto.decode(data);
            } else if (typeof data === 'object') {
                const errMsg = blockHeaderProto.verify(data);
                if (errMsg) throw new Error(`BlockInfo: ${errMsg}`);
                this._data = {
                    header: blockHeaderProto.create(data),
                    flags: EXECUTED_BLOCK
                };
            }
        }

        /**
         *
         * @returns {Array} of strings!
         */
        get parentHashes() {
            return this._data.header.parentHashes.map(hash => hash.toString('hex'));
        }

        /**
         *
         * @returns {String}
         */
        getHash() {
            return Crypto.createHash(blockHeaderProto.encode(this._data.header).finish());
        }

        getHeight() {
            return this._data.header.height;
        }

        get conciliumId() {
            return this._data.header.conciliumId;
        }

        getConciliumId() {
            return this._data.header.conciliumId;
        }

        getHeader() {
            return this._data.header;
        }

        markAsBad() {
            this._data.flags = BAD_BLOCK;
        }

        isBad() {
//            return !!(this._data.flags & BAD_BLOCK);
            return this._data.flags === BAD_BLOCK;
        }

        markAsFinal() {
            this._data.flags = FINAL_BLOCK;
        }

        isFinal() {
            return this._data.flags === FINAL_BLOCK;
        }

        markAsInFlight() {
            this._data.flags = IN_FLIGHT_BLOCK;
        }

        isInFlight() {
            return this._data.flags === IN_FLIGHT_BLOCK;
        }

        encode() {
            return blockInfoProto.encode(this._data).finish();
        }

        getState() {
            return this._data.flags;
        }

        getTimestamp(){
            return this._data.header.timestamp;
        }

    };
