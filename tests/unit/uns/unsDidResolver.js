function getUnsDidResolver(unsDid) {
    return class DidDocument {
        get(address) {
            return unsDid._didDocument[address];
        }
    };
}

module.exports = getUnsDidResolver;
