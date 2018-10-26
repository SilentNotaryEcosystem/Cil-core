const typeforce = require('typeforce');
const types = require('../types');

// Class to store block header + additional info in DB

module.exports = ({Constants}, {blockInfoProto, blockHeaderProto}) =>

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
                    isBad: 0
                };
            }
        }

        getHeader() {
            return this._data.header;
        }

        markAsBad() {
            this._data.isBad = 1;
        }

        isBad() {
            return !!this._data.isBad;
        }

        encode() {
            return blockInfoProto.encode(this._data).finish();
        }

    };
