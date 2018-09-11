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

const Hash256bit = typeforce.BufferN(32);

module.exports = {
    Hash256bit,
    Address: typeforce.BufferN(20),
    PrivateKey,
    Empty,
    InvVector: typeforce.compile({type: 'Number', hash: Hash256bit})
};
