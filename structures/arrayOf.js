const typeforce = require('typeforce');

module.exports = nEntityLength => {
    typeforce(typeforce.Number, nEntityLength);

    /**
     * Used for serialization in storage & MsgGetBlocks
     * this._arrOf contains Buffers,
     * BUT
     * this.getArray returns Strings!
     */
    return class ArrayOf {
        /**
         *
         * @param {Array | Buffer} data
         */
        constructor(data) {
            if (Buffer.isBuffer(data)) {
                this._ensureLength(data);

                this._arrOf = [];
                for (let start = 0; start < data.length; start += nEntityLength) {
                    this._arrOf.push(data.slice(start, start + nEntityLength));
                }
            } else if (Array.isArray(data)) {
                this._arrOf = data.map(e => {
                    this._ensureLength(e);
                    return Buffer.isBuffer(e) ? e : Buffer.from(e, 'hex');
                });
            } else {
                throw new Error('Construct Array of (HASHES | ADDRESSES) or decode from buffer');
            }
        }

        /**
         *
         * @return {string[]} !!!!
         */
        getArray() {
            return this._arrOf.map(e => e.toString('hex'));
        }

        /**
         *
         * @return {Buffer}
         */
        encode() {
            return Buffer.concat(this._arrOf);
        }

        _ensureLength(element) {
            if (element.length % nEntityLength) {
                throw new Error(`Buffer you trying to decode not ${nEntityLength} bytes aligned!`);
            }
        }
    };
};
