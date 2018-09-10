module.exports = {
    sleep: (delay) => {
        return new Promise(resolve => {
            setTimeout(() => resolve(), delay);
        });
    },

    createDummyTx: (hash) => {
        const pseudoRandomBytes = Buffer.allocUnsafe(32);

        // this will prevent all zeroes buffer (it will make tx invalid
        pseudoRandomBytes[0] = 1;
        return {
            payload: {
                ins: [{txHash: hash ? hash : pseudoRandomBytes, nTxOutput: parseInt(Math.random() * 1000) + 1}],
                outs: [{amount: parseInt(Math.random() * 1000) + 1}]
            },
            claimProofs: [Buffer.allocUnsafe(32)]
        };
    }
};
