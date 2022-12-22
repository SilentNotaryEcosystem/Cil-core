'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const {Did: DidContract} = require('../did');
const {DidProxy: DidProxyContract} = require('./didProxy');
const factory = require('../../../testFactory');

const {generateAddress /*, pseudoRandomBuffer*/} = require('../../../testUtil');

let proxyContract;

describe('DidProxy', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function () {
        // this.timeout(15000);
    });

    beforeEach(async () => {
        // global.value = 0;
        global.callerAddress = generateAddress().toString('hex');
        // global.contractTx = pseudoRandomBuffer().toString('hex');
        // global.block = {
        //     height: 100,
        //     hash: 'hash'
        // };

        proxyContract = new DidProxyContract();
    });

    it('Should fail to get active DID contract', () => {
        assert.throws(() => proxyContract.getActiveDid(), 'There is no acitve DID!');
    });

    it('Should not fail to get active DID contract', () => {
        const contract = new DidContract();
        proxyContract.add(contract);
        proxyContract.getActiveDid();
    });
});
