const pseudoRandomBuffer = (length = 32) => {
    const pseudoRandomBytes = Buffer.allocUnsafe(length);

    // this will prevent all zeroes buffer (it will make tx invalid
    pseudoRandomBytes[0] = parseInt(Math.random() * 255);
    return pseudoRandomBytes;
};

module.exports = {
    sleep: (delay) => {
        return new Promise(resolve => {
            setTimeout(() => resolve(), delay);
        });
    },

    createDummyTx: (hash) => {
        return {
            payload: {
                ins: [{txHash: hash ? hash : pseudoRandomBuffer(), nTxOutput: parseInt(Math.random() * 1000) + 1}],
                outs: [{amount: parseInt(Math.random() * 1000) + 1, codeClaim: pseudoRandomBuffer()}],
                witnessGroupId: 0
            },
            claimProofs: [pseudoRandomBuffer()]
        };
    },

    createDummyPeer: (factory) => ({
        peerInfo: {
            capabilities: [
                {service: factory.Constants.WITNESS, data: pseudoRandomBuffer()}
            ],
            address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x5}
        }
    }),

    createDummyBlock: (factory) => {
        const block = new factory.Block(0);
        block.finish(factory.Constants.MIN_TX_FEE, pseudoRandomBuffer(33));
        return block;
    },

    pseudoRandomBuffer
};
