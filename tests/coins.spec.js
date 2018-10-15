'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('./testFactory');

describe('Coins', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create Coins', async () => {
        new factory.Coins(10, Buffer.allocUnsafe(100));
    });

    it('should pass coins EQUALITY', async () => {
        const buffer = Buffer.allocUnsafe(100);
        const coin1 = new factory.Coins(10, buffer);
        const coin2 = new factory.Coins(10, buffer);
        assert.isOk(coin1.equals(coin2));
        assert.isOk(coin2.equals(coin1));
    });

    it('should fail coins EQUALITY', async () => {
        const coin1 = new factory.Coins(10, Buffer.allocUnsafe(100));
        const coin2 = new factory.Coins(10, Buffer.allocUnsafe(100));
        assert.isNotOk(coin1.equals(coin2));
        assert.isNotOk(coin2.equals(coin1));
    });
});
