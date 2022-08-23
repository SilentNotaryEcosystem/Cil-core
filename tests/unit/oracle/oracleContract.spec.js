'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
chai.use(require('chai-as-promised'));
const {assert} = chai;

const {Base, RatesOracle} = require('./oracle');
const factory = require('../testFactory');

const {generateAddress, pseudoRandomBuffer} = require('../testUtil');

describe('Oracle contract', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function () {
        this.timeout(15000);
    });

    beforeEach(async () => {
        global.value = 1e8;
        global.callerAddress = generateAddress().toString('hex');
        global.contractTx = pseudoRandomBuffer().toString('hex');
        global.block = {
            timestamp: parseInt(Date.now() / 1000)
        };

        // contract = new RatesOracle();
    });

    describe('Base', async () => {
        let base;

        beforeEach(async () => {
            base = new Base();
        });

        describe('_checkManager', async () => {
            it('should pass for empty (owner is also manager)', async () => {
                base._checkManager();
            });
            it('should throw for empty (not owner)', async () => {
                global.callerAddress = generateAddress().toString('hex');

                assert.throws(() => base._checkManager(), 'Unauthorized call');
            });

            it('should throw (no match and not owner)', async () => {
                base._managers = [generateAddress().toString('hex')];
                global.callerAddress = generateAddress().toString('hex');

                assert.throws(() => base._checkManager(), 'Unauthorized call');
            });

            it('should pass', async () => {
                base._managers = [generateAddress().toString('hex')];
                global.callerAddress = base._managers[0];

                base._checkManager();
            });
        });

        describe('addManager', async () => {
            it('should fail to addManager (bad address)', async () => {
                assert.throws(() => base.addManager('aaa'), 'Bad address');
            });

            it('should fail to add (not an owner)', async () => {
                global.callerAddress = generateAddress().toString('hex');

                assert.throws(() => base.addManager(generateAddress().toString('hex')), 'Unauthorized call');
            });

            it('should addManager', async () => {
                const strAdrr = generateAddress().toString('hex');

                base.addManager(strAdrr);

                // shouldn't throw
                global.callerAddress = strAdrr;
                base._checkManager();
            });
        });

        describe('removeManager', async () => {
            it('should remove (empty)', async () => {
                base.removeManager(generateAddress().toString('hex'));
            });

            it('should remove (non existent)', async () => {
                base.addManager(generateAddress().toString('hex'));

                base.removeManager(generateAddress().toString('hex'));
            });

            it('should remove (existent)', async () => {
                const strAdrr = generateAddress().toString('hex');
                base.addManager(strAdrr);

                base.removeManager(strAdrr);

                assert.isOk(base._managers.length === 0);
            });
        });
    });

    describe('RatesOracle', async () => {
        let oracle;

        beforeEach(async () => {
            oracle = new RatesOracle();
        });

        it('should start new ticker', async () => {
            oracle.publish('ETH', 14);

            assert.isOk(oracle._data['ETH']);
            assert.isOk(oracle._data['ETH'].timeBase === block.timestamp);
            assert.isOk(oracle._data['ETH'].arrData.length === 1);
            assert.deepEqual(oracle._data['ETH'].arrData[0], [0, 14]);

            oracle.publish('BTC', 15);
            assert.isOk(oracle._data['BTC']);
            assert.isOk(oracle._data['BTC'].timeBase === block.timestamp);
            assert.isOk(oracle._data['BTC'].arrData.length === 1);
            assert.deepEqual(oracle._data['BTC'].arrData[0], [0, 15]);
        });

        it('should publishBatch', async () => {
            oracle.publishBatch([
                ['ETH', 14],
                ['BTC', 15]
            ]);

            assert.isOk(oracle._data['ETH']);
            assert.isOk(oracle._data['ETH'].timeBase === block.timestamp);
            assert.isOk(oracle._data['ETH'].arrData.length === 1);
            assert.deepEqual(oracle._data['ETH'].arrData[0], [0, 14]);

            assert.isOk(oracle._data['BTC']);
            assert.isOk(oracle._data['BTC'].timeBase === block.timestamp);
            assert.isOk(oracle._data['BTC'].arrData.length === 1);
            assert.deepEqual(oracle._data['BTC'].arrData[0], [0, 15]);
        });

        it('should publish 2 values (with offset)', async () => {
            const nTimeStart = block.timestamp;
            oracle.publish('ETH', 14);

            block.timestamp = nTimeStart + 5;
            oracle.publish('ETH', 24);

            assert.isOk(oracle._data['ETH'].arrData.length === 2);
            assert.isOk(oracle._data['ETH'].timeBase === nTimeStart);

            assert.deepEqual(oracle._data['ETH'].arrData[0], [0, 14]);
            assert.deepEqual(oracle._data['ETH'].arrData[1], [5, 24]);
        });

        it('should throw', async () => {
            assert.throws(() => oracle.getDataForTicker('ETH'), 'Ticker ETH not found');
        });

        it('should get 2 published values', async () => {
            const nTimeStart = block.timestamp;
            oracle.publish('ETH', 14);

            block.timestamp = nTimeStart + 5;
            oracle.publish('ETH', 24);

            assert.deepEqual(oracle.getDataForTicker('ETH'), [
                [nTimeStart, 14],
                [nTimeStart + 5, 24]
            ]);
        });

        it('should get only last published value', async () => {
            const nTimeStart = block.timestamp;
            oracle.publish('ETH', 14);

            block.timestamp = nTimeStart + 5;
            oracle.publish('ETH', 24);

            assert.deepEqual(oracle.getDataForTicker('ETH', 1), [[nTimeStart + 5, 24]]);
        });
    });
});
