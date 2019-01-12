const typeforce = require('typeforce');

// it's some sorta strange, but i saw 31 byte length keys
function PrivateKey(value) {
    if (!typeforce.String(value)) {
        if (!typeforce.Buffer(value)) {
            return false;
        } else {
            return value.length >= 31 || value.length <= 32;
        }
    } else {
        return value.length >= 62 || value.length <= 64;
    }
}

function PublicKey(value) {
    if (!typeforce.String(value)) {
        if (!typeforce.Buffer(value)) {
            return false;
        } else {
            return value.length === 33;
        }
    } else {
        return value.length === 66;
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
    Str64,
    Buf32: typeforce.BufferN(32),
    Hash256bit,
    Address: typeforce.BufferN(20),
    PrivateKey,
    PublicKey,
    Empty,
    InvVector: typeforce.compile({type: 'Number', hash: Hash256bit}),
    Coins: typeforce.quacksLike('Coins'),
    Patch: typeforce.quacksLike('PatchDB'),
    Block: typeforce.quacksLike('Block'),
    BlockInfo: typeforce.quacksLike('BlockInfo'),
    Transaction: typeforce.quacksLike('Transaction'),
    Amount,
    Signature: typeforce.BufferN(65),
    Input: typeforce.compile({nTxOutput: 'Number', txHash: Hash256bit})
};
