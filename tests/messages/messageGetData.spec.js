'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const {createDummyTx} = require('../testUtil');

const factory = require('../testFactory');

describe('MessageGetData', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create empty message', async () => {
        const msg = new factory.Messages.MsgGetData();
        assert.isOk(msg.network);
        assert.equal(msg.network, factory.Constants.network);
        assert.isOk(msg.isGetData());
    });

    it('should create from inventory', async () => {
        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        inv.addTx(tx);

        const msg = new factory.Messages.MsgGetData(inv);
        assert.isOk(msg.inventory.vector);
        assert.equal(msg.inventory.vector.length, 1);
    });

    it('should set/get inventory', async () => {
        const msg = new factory.Messages.MsgGetData();

        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        inv.addTx(tx);

        const block = new factory.Block(0);
        block.addTx(tx);
        inv.addBlock(block);

        msg.inventory = inv;

        const restoredInv = msg.inventory;
        assert.isOk(restoredInv);
    });

    it('should encode/decode message', async () => {
        const msg = new factory.Messages.MsgGetData();

        const inv = new factory.Inventory();
        const tx = new factory.Transaction(createDummyTx());
        inv.addTx(tx);

        const block = new factory.Block(0);
        block.addTx(tx);
        inv.addBlock(block);

        msg.inventory = inv;
        const buffMsg = msg.encode();
        assert.isOk(Buffer.isBuffer(buffMsg));

        const msgCommon = new factory.Messages.MsgCommon(buffMsg);
        const restoredMsg = new factory.Messages.MsgGetData(msgCommon);

        const wrapper = () => restoredMsg.inventory;
        assert.doesNotThrow(wrapper);
    });

    it('should fail to decode malformed message', async () => {
        const msg = new factory.Messages.MsgGetData();
        msg.payload = Buffer.from('123');

        const wrapper = () => msg.inventory;
        assert.throws(wrapper);
    });
});
