const pseudoRandomBuffer = (length = 32) => {
    const pseudoRandomBytes = Buffer.allocUnsafe(length);

    // this will prevent all zeroes buffer (it will make tx invalid
    pseudoRandomBytes[0] = parseInt(Math.random() * 255);
    return pseudoRandomBytes;
};

const createDummyTx = (hash, witnessGroupId) => {
    return {
        payload: {
            ins: [{txHash: hash ? hash : pseudoRandomBuffer(), nTxOutput: parseInt(Math.random() * 1000) + 1}],
            outs: [{amount: parseInt(Math.random() * 1000) + 1, receiverAddr: pseudoRandomBuffer(20)}],
            witnessGroupId: witnessGroupId !== undefined ? witnessGroupId : 0
        },
        claimProofs: [pseudoRandomBuffer()]
    };
};

module.exports = {
    sleep: (delay) => {
        return new Promise(resolve => {
            setTimeout(() => resolve(), delay);
        });
    },
    createDummyTx,
    createDummyPeer: (factory) => ({
        peerInfo: {
            capabilities: [
                {service: factory.Constants.WITNESS, data: pseudoRandomBuffer()}
            ],
            address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x5}
        }
    }),

    createDummyBlock: (factory, witnessId = 0) => {
        const block = new factory.Block(witnessId);
        block.parentHashes = [pseudoRandomBuffer().toString('hex')];
        block.finish(factory.Constants.MIN_TX_FEE, pseudoRandomBuffer(33));
        return block;
    },

    createDummyBlockWithTx: (factory, witnessId = 0) => {
        const block = new factory.Block(witnessId);
        const tx = new factory.Transaction(createDummyTx());
        block.addTx(tx);
        block.parentHashes = [pseudoRandomBuffer().toString('hex')];
        block.finish(factory.Constants.MIN_TX_FEE, pseudoRandomBuffer(33));
        return block;
    },

    pseudoRandomBuffer,

    createNonMergeablePatch: (factory) => {
        const patch = new factory.PatchDB();
        const patchThatWouldntMerge = new factory.PatchDB();
        patchThatWouldntMerge._data = undefined;
        return patchThatWouldntMerge;
    }
};
