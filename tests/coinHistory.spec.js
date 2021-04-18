const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');
const debug = require('debug');

const {sleep} = require('../utils');

const factory = require('./testFactory');

describe('coinHistory tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create', async () => {
        new factory.CoinHistory();
    });

    it('should add record', async () => {
        const ch = new factory.CoinHistory();

        ch.recordReceive('a'.repeat(64), 0, new factory.Coins(1e5, Buffer.from('b'.repeat(40), 'hex')));
    });

    it('should iterate throught tx hashes', async () => {
        const ch = new factory.CoinHistory();
        const strHash1 = 'a'.repeat(64);
        const strHash2 = 'b'.repeat(64);
        ch.recordReceive(strHash1, 0, new factory.Coins(1e5, Buffer.from('b'.repeat(40), 'hex')));
        ch.recordReceive(strHash2, 0, new factory.Coins(1e5, Buffer.from('b'.repeat(40), 'hex')));

        const arrValues = Array.from(ch);

        assert.equal(arrValues[0][0], strHash1);
        assert.equal(arrValues[1][0], strHash2);
    });

    it('should merge', async () => {
        const ch1 = new factory.CoinHistory();
        const ch2 = new factory.CoinHistory();
        const strHash1 = 'a'.repeat(64);
        const strHash2 = 'b'.repeat(64);
        ch1.recordReceive(strHash1, 0, new factory.Coins(1e5, Buffer.from('b'.repeat(40), 'hex')));
        ch2.recordReceive(strHash2, 0, new factory.Coins(1e5, Buffer.from('b'.repeat(40), 'hex')));

        const chMerged = ch1.mergeHistory(ch2);

        const arrValues = Array.from(chMerged);
        assert.equal(arrValues[0][0], strHash1);
        assert.equal(arrValues[1][0], strHash2);
    });

    describe('Purge', async () => {

        it('should leave unchanged (no intersection)', async () => {
            const ch1 = new factory.CoinHistory();
            const ch2 = new factory.CoinHistory();
            const strHash1 = 'a'.repeat(64);
            const strHash2 = 'b'.repeat(64);
            ch1.recordReceive(strHash1, 0, new factory.Coins(1e5, Buffer.from('b'.repeat(40), 'hex')));
            ch2.recordReceive(strHash2, 0, new factory.Coins(1e5, Buffer.from('b'.repeat(40), 'hex')));

            ch1.purgeHistory(ch2);

            const arrValues = Array.from(ch1);
            assert.equal(arrValues.length, 1);
            assert.equal(arrValues[0][0], strHash1);
        });

        it('should leave unchanged (empty)', async () => {
            const ch1 = new factory.CoinHistory();
            const ch2 = new factory.CoinHistory();
            const strHash2 = 'b'.repeat(64);
            ch2.recordReceive(strHash2, 0, new factory.Coins(1e5, Buffer.from('b'.repeat(40), 'hex')));

            ch1.purgeHistory(ch2);

            const arrValues = Array.from(ch1);
            assert.equal(arrValues.length, 0);
        });

        it('should purge', async () => {
            const ch1 = new factory.CoinHistory();
            const ch2 = new factory.CoinHistory();
            const strHash1 = 'a'.repeat(64);
            const strHash2 = 'b'.repeat(64);
            ch1.recordReceive(strHash1, 0, new factory.Coins(1e5, Buffer.from('b'.repeat(40), 'hex')));
            ch2.recordReceive(strHash2, 0, new factory.Coins(1e5, Buffer.from('b'.repeat(40), 'hex')));
            const chMerged = ch1.mergeHistory(ch2);

            chMerged.purgeHistory(ch2);

            const arrValues = Array.from(chMerged);
            assert.equal(arrValues.length, 1);
            assert.equal(arrValues[0][0], strHash1);
        });
    });
});
