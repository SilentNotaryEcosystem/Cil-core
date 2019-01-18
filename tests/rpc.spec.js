'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon').createSandbox();

const factory = require('./testFactory');
const {createDummyTx, pseudoRandomBuffer} = require('./testUtil');

describe('RPC', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create instance', async () => {
        new factory.RPC({rpcAddress: factory.Transport.generateAddress()});
    });

    it('should emit TX event', (done) => {
        const rpc = new factory.RPC({rpcAddress: factory.Transport.generateAddress()});
        const tx = new factory.Transaction(createDummyTx());
        rpc.on('rpc', ({event, content}) => {
            assert.isOk(event);
            assert.isOk(content);
            assert.equal(event, 'tx');
            assert.isOk(tx.equals(content));
            done();
        });

        rpc.sendRawTx({buffTx: tx.encode()});
    });

    it('should get TX receipt', (done) => {
        const rpc = new factory.RPC({rpcAddress: factory.Transport.generateAddress()});
        const strTxHash = pseudoRandomBuffer().toString('hex');
        rpc.on('rpc', ({event, content}) => {
            assert.isOk(event);
            assert.isOk(content);
            assert.equal(event, 'txReceipt');
            assert.equal(content, strTxHash);
            done();
        });

        rpc.getTxReceipt({strTxHash});
    });
});
