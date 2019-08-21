const pseudoRandomBuffer = (length = 32) => {
    const pseudoRandomBytes = Buffer.allocUnsafe(length);

    // this will prevent all zeroes buffer (it will make tx invalid
    pseudoRandomBytes[0] = parseInt(Math.random() * 255);
    return pseudoRandomBytes;
};

const generateAddress = () => {
    return pseudoRandomBuffer(20);
};

const createDummyTx = (hash, conciliumId) => {
    return {
        payload: {
            ins: [{txHash: hash ? hash : pseudoRandomBuffer(), nTxOutput: parseInt(Math.random() * 1000) + 1}],
            outs: [{amount: parseInt(Math.random() * 1000) + 1, receiverAddr: generateAddress()}],
            conciliumId: conciliumId !== undefined ? conciliumId : 0
        },
        claimProofs: [pseudoRandomBuffer()]
    };
};

const createDummyBlock = (factory, nConciliumId = 0) => {
    const block = new factory.Block(nConciliumId);
    block.parentHashes = [pseudoRandomBuffer().toString('hex')];
    block.finish(factory.Constants.fees.TX_FEE, generateAddress());
    return block;
};

const createDummyBlockInfo = (factory) => {
    const block = createDummyBlock(factory);
    return new factory.BlockInfo(block.header);
};

module.exports = {
    generateAddress,
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

    createDummyBlock,
    createDummyBlockInfo,
    pseudoRandomBuffer,

    createDummyBlockWithTx: (factory, nConciliumId = 0) => {
        const block = new factory.Block(nConciliumId);
        const tx = new factory.Transaction(createDummyTx());
        block.addTx(tx);
        block.parentHashes = [pseudoRandomBuffer().toString('hex')];
        block.finish(factory.Constants.fees.TX_FEE, generateAddress());
        return block;
    },

    createNonMergeablePatch: (factory) => {
        const patchThatWouldntMerge = new factory.PatchDB(0);
        patchThatWouldntMerge._data = undefined;
        return patchThatWouldntMerge;
    },

    processBlock: async (node, block) => {
        await node._blockInFlight(block);
        const patch = await node._execBlock(block);
        await node._acceptBlock(block, patch);
        await node._postAcceptBlock(block);
        await node._informNeighbors(block);

        return patch;
    },
    createObjInvocationCode(strMethod, arrArguments) {
        return {
            method: strMethod,
            arrArguments
        };
    }
};
