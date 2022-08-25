'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('../testFactory');
const {generateAddress} = require('../testUtil');

describe('Coins', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function () {
        this.timeout(15000);
    });

    it('should create Coins', async () => {
        new factory.Coins(10, generateAddress());
        new factory.Coins(10, generateAddress().toString('hex'));
    });

    it('should pass coins EQUALITY', async () => {
        const address = generateAddress();
        const coin1 = new factory.Coins(10, address);
        const coin2 = new factory.Coins(10, address);
        assert.isOk(coin1.equals(coin2));
        assert.isOk(coin2.equals(coin1));
    });

    it('should fail coins EQUALITY', async () => {
        const coin1 = new factory.Coins(10, generateAddress());
        const coin2 = new factory.Coins(10, generateAddress());
        assert.isNotOk(coin1.equals(coin2));
        assert.isNotOk(coin2.equals(coin1));
    });
});
