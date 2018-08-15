const BN = require('bn.js');

module.exports = {
    toBuffer: (v) => {
        if (!Buffer.isBuffer(v)) {
            if (Array.isArray(v)) {
                v = Buffer.from(v);
            } else if (typeof v === 'string') {
                if (module.exports.isHexString(v)) {
                    v = Buffer.from(module.exports.padToEven(module.exports.stripHexPrefix(v)), 'hex');
                } else {
                    v = Buffer.from(v);
                }
            } else if (typeof v === 'number') {
                v = module.exports.intToBuffer(v);
            } else if (v === null || v === undefined) {
                v = Buffer.allocUnsafe(0);
            } else if (BN.isBN(v)) {
                v = v.toArrayLike(Buffer);
            } else if (v.toArray) {
                // converts a BN to a Buffer
                v = Buffer.from(v.toArray());
            } else {
                throw new Error('invalid type');
            }
        }
        return v;
    },
    isHexString: (value, length) => {
        if (typeof value !== 'string' || !value.match(/^0x[0-9A-Fa-f]*$/)) {
            return false;
        }

        if (length && value.length !== 2 + 2 * length) {
            return false;
        }

        return true;
    },
    padToEven: (value) => {
        var a = value; // eslint-disable-line

        if (typeof a !== 'string') {
            throw new Error('While padding to even, value must be string, is currently ' + typeof a + ', while padToEven.');
        }

        if (a.length % 2) {
            a = '0' + a;
        }

        return a;
    },
    stripHexPrefix: (str) => {
        if (typeof str !== 'string') {
            return str;
        }

        return module.exports.isHexPrefixed(str) ? str.slice(2) : str;
    },
    isHexPrefixed: (str) => {
        if (typeof str !== 'string') {
            throw new Error("Value must be type 'string', is currently type " + (typeof str) + ", while checking isHexPrefixed.");
        }

        return str.slice(0, 2) === '0x';
    },
    intToBuffer: (i) => {
        var hex = module.exports.intToHex(i);

        return new Buffer(module.exports.padToEven(hex.slice(2)), 'hex');
    },
    intToHex: (i) => {
        var hex = i.toString(16);

        return '0x' + hex;
    }
};
