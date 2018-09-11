const typeforce = require('typeforce');

function PrivateKey(value) {
    if (!typeforce.String(value)) {
        if (!typeforce.Buffer(value)) {
            return false;
        } else {
            return value.length === 32;
        }
    } else {
        return value.length === 64;
    }
}

function Empty(value) {
    return value === undefined;
}

module.exports = {
    Hash256bit: typeforce.BufferN(32),
    Address: typeforce.BufferN(20),
    PrivateKey,
    Empty
};
