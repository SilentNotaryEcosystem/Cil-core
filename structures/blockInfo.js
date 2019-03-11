const typeforce = require('typeforce');
const types = require('../types');

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
                    flags: Constants.EXECUTED_BLOCK
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

        getWitnessId() {
            return this._data.header.witnessGroupId;
        }

        getHeader() {
            return this._data.header;
        }

        markAsBad() {
            this._data.flags = Constants.BAD_BLOCK;
        }

        isBad() {
//            return !!(this._data.flags & BAD_BLOCK);
            return this._data.flags === Constants.BAD_BLOCK;
        }

        markAsFinal() {
            this._data.flags = Constants.FINAL_BLOCK;
        }

        isFinal() {
            return this._data.flags === Constants.FINAL_BLOCK;
        }

        markAsInFlight() {
            this._data.flags = Constants.IN_FLIGHT_BLOCK;
        }

        isInFlight() {
            return this._data.flags === Constants.IN_FLIGHT_BLOCK;
        }

        encode() {
            return blockInfoProto.encode(this._data).finish();
        }

        getState() {
            return this._data.flags;
        }

    };
