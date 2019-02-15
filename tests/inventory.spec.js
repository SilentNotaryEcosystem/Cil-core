const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('./testFactory');
const {createDummyTx, pseudoRandomBuffer} = require('./testUtil');

describe('Inventory', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create empty inventory', async () => {
        new factory.Inventory();
    });

    it('should add tx', async () => {
        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        inv.addTx(tx);
        assert.isOk(inv.vector[0]);
        assert.isOk(inv.vector[0].type, factory.Constants.INV_TX);
    });

    it('should add TX (by hash)', async () => {
        const inv = new factory.Inventory();
        const txHash = pseudoRandomBuffer();
        inv.addTxHash(txHash);
        assert.isOk(inv.vector[0]);
        assert.isOk(inv.vector[0].type, factory.Constants.INV_TX);

    });

    it('should add block', async () => {
        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        const block = new factory.Block(0);

        block.addTx(tx);
        block.finish(factory.Constants.MIN_TX_FEE, pseudoRandomBuffer(33));

        inv.addBlock(block);
        assert.isOk(inv.vector[0]);
        assert.isOk(inv.vector[0].type, factory.Constants.INV_BLOCK);
    });

    it('should add block (by hash)', async () => {
        const inv = new factory.Inventory();
        const blockHash = pseudoRandomBuffer();
        inv.addBlockHash(blockHash);
        assert.isOk(inv.vector[0]);
        assert.isOk(inv.vector[0].type, factory.Constants.INV_BLOCK);

    });

    it('should encode/decode inventory', async () => {
        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        inv.addTx(tx);

        const block = new factory.Block(0);
        block.addTx(tx);
        block.finish(factory.Constants.MIN_TX_FEE, pseudoRandomBuffer(33));

        inv.addBlock(block);

        const buffer = inv.encode();
        const restoredInv = new factory.Inventory(buffer);
        assert.isOk(restoredInv.vector[0]);
        assert.isOk(restoredInv.vector[0].type, factory.Constants.INV_TX);
        assert.isOk(restoredInv.vector[1]);
        assert.isOk(restoredInv.vector[1].type, factory.Constants.INV_BLOCK);

        // should restore internal cache upon decoding, to prevent adding element more than one time
        restoredInv.addTx(tx);
        assert.equal(restoredInv.vector.length, 2);
    });

});
