const typeforce = require('typeforce');
const types = require('../types');

// we use 256bit hashes
const HASH_LENGTH = 32;

module.exports = () =>

    /**
     * Used for serialization in storage & MsgGetBlocks
     */
    class ArrayOfHashes {

        /**
         *
         * @param {Array | Buffer} data
         */
        constructor(data) {
            typeforce(typeforce.oneOf(typeforce.arrayOf(types.Hash256bit), 'Buffer'), data);

            if (Buffer.isBuffer(data)) {
                if (data.length % HASH_LENGTH) {
                    throw new Error(`Buffer you trying to decode not ${HASH_LENGTH} bytes aligned!`);
                }
                this._arrHashes = [];
                for (let start = 0; start < data.length; start += HASH_LENGTH) {
                    this._arrHashes.push(data.slice(start, start + HASH_LENGTH));
                }
            } else if (Array.isArray(data)) {
                this._arrHashes = data.map(e => Buffer.isBuffer(e) ? e : Buffer.from(e, 'hex'));
            } else {
                throw new Error('Construct Array of Hashes or decode from buffer');
            }
        }

        /**
         *
         * @return {string[]} !!!!
         */
        getArray() {
            return this._arrHashes.map(e => e.toString('hex'));
        }

        /**
         *
         * @return {Buffer}
         */
        encode() {
            return Buffer.concat(this._arrHashes);
        }

    };
