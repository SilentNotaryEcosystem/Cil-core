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

function Str64(value) {
    return typeof value === 'string' && value.length === 64;
}

function Amount(value) {
    return typeof value === 'number';
}

const Hash256bit = typeforce.oneOf(typeforce.BufferN(32), Str64);

module.exports = {
    Hash256bit,
    Address: typeforce.BufferN(20),
    PrivateKey,
    Empty,
    InvVector: typeforce.compile({type: 'Number', hash: Hash256bit}),
    Coins: typeforce.quacksLike('Coins'),
    Amount,
    Signature: typeforce.BufferN(65)
};
