'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');

const factory = require('./testFactory');
const {pseudoRandomBuffer, generateAddress} = require('./testUtil');
const {GCD} = require('../utils');

const generateSeed = (nTotalRound) => (Math.random() * nTotalRound) % 8192;

describe('Conciliums', async () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    describe('BaseConciliumDefinition', () => {
        it('should get constant CONCILIUM_TYPE_POS', async () => {
            assert.equal(factory.BaseConciliumDefinition.CONCILIUM_TYPE_POS, 1);
        });
        it('should get constant CONCILIUM_TYPE_RR', async () => {
            assert.equal(factory.BaseConciliumDefinition.CONCILIUM_TYPE_RR, 0);
        });
    });
    describe('ConciliumRr', () => {
        after(async function() {
            this.timeout(15000);
        });

        it('should FAIL to create', async () => {
            assert.throws(() => new factory.ConciliumRr());
        });

        it('should create', async () => {
            new factory.ConciliumRr({
                publicKeys: [pseudoRandomBuffer(33), pseudoRandomBuffer(33)],
                conciliumId: 10,
                quorum: 1,
                delegatesPublicKeys: [pseudoRandomBuffer(33), pseudoRandomBuffer(33)],
                parameters: {
                    feeTxSize: 15000,
                    feeContractCreation: 1e12,
                    feeContractInvocation: 15000
                }
            });

            factory.ConciliumRr.create(
                10,
                [pseudoRandomBuffer(33), pseudoRandomBuffer(33)],
                [pseudoRandomBuffer(33), pseudoRandomBuffer(33)]
            );
        });

        it('should return quorum', async () => {
            {
                const arrPubKeys = [pseudoRandomBuffer(33), pseudoRandomBuffer(33)];
                const def = factory.ConciliumRr.create(10, arrPubKeys);

                // one delegate
                assert.equal(def.getQuorum(), 2);
            }
            {
                const arrPubKeys = [pseudoRandomBuffer(33), pseudoRandomBuffer(33)];
                const def = factory.ConciliumRr.create(10, arrPubKeys);

                // two delegates from pubKeys
                assert.equal(def.getQuorum(), 2);
            }
            {
                const arrPubKeys = [pseudoRandomBuffer(33), pseudoRandomBuffer(33)];
                const def = factory.ConciliumRr.create(10, arrPubKeys, 10);

                // manually specified
                assert.equal(def.getQuorum(), 10);
            }

            {
                const arrPubKeys = [pseudoRandomBuffer(33), pseudoRandomBuffer(33)];
                const def = factory.ConciliumRr.create(10, arrPubKeys);
                def.setQuorum(10);

                // manually specified
                assert.equal(def.getQuorum(), 10);
            }
        });

        it('should get fees parameters', async () => {
            const feeTxSize = 15000;
            const feeContractCreation = 1e12;
            const feeContractInvocation = 15000;
            const feeStorage = 15;

            const concilium = new factory.ConciliumRr({
                publicKeys: [pseudoRandomBuffer(33), pseudoRandomBuffer(33)],
                conciliumId: 10,
                quorum: 1,
                parameters: {
                    fees: {
                        feeTxSize,
                        feeContractCreation,
                        feeContractInvocation,
                        feeStorage
                    }
                }
            });

            assert.equal(concilium.getFeeTxSize(), feeTxSize);
            assert.equal(concilium.getFeeContractCreation(), feeContractCreation);
            assert.equal(concilium.getFeeContractInvocation(), feeContractInvocation);
            assert.equal(concilium.getFeeStorage(), feeStorage);
        });

        it('should be isRoundRobin', async () => {
            const def = factory.ConciliumRr.create(10, [pseudoRandomBuffer(33), pseudoRandomBuffer(33)]);
            assert.isOk(def.isRoundRobin());
        });

        describe('nextRound', async () => {
            let concilium;
            beforeEach(async () => {
                concilium = factory.ConciliumRr.create(10, [pseudoRandomBuffer(33), pseudoRandomBuffer(33)]);
            });

            it('should increase roundNo', async () => {
                concilium.initRounds();
                const nPrevRound = concilium.getRound();

                concilium.nextRound();

                assert.notEqual(nPrevRound, concilium.getRound());
            });

            it('should just increase round', async () => {
                concilium.initRounds();
                concilium.initRounds = sinon.fake();

                concilium.nextRound();

                assert.isNotOk(concilium.initRounds.calledOnce);
            });

            it('should reInit', async () => {
                concilium.initRounds();
                concilium._nLocalRound = concilium._data.addresses.length;

                concilium.initRounds = sinon.fake();
                concilium.nextRound();

                assert.isOk(concilium.initRounds.calledOnce);
            });
        });
    });

    describe('ConciliumPoS', () => {
        let concilium;
        beforeEach(async () => {
            concilium = factory.ConciliumPos.create(11, 1e3, 100,
                [
                    {amount: 1e3, address: generateAddress().toString('hex')},
                    {amount: 1e5, address: generateAddress().toString('hex')}
                ]
            );
        });

        it('should FAIL to create', async () => {
            assert.throws(() => new factory.ConciliumPos());
        });

        it('should _formProposerAddressesSequence', async () => {

            concilium._formProposerAddressesSequence(11);
            assert.isOk(concilium._arrProposers.length === concilium._nSeqLength);
        });

        it('should sort members from most staked', async () => {
            const arrMembers=[
                {amount: 1e3, address: generateAddress().toString('hex')},
                {amount: 1e5, address: generateAddress().toString('hex')}
            ];
            concilium = factory.ConciliumPos.create(11, 1e3, 100, arrMembers);

            assert.deepEqual(concilium.getAddresses(false, true), [
                arrMembers[1].address,
                arrMembers[0].address
            ]);
        });

        it('should keep original order', async () => {
            const arrMembers=[
                {amount: 1e3, address: generateAddress().toString('hex')},
                {amount: 1e5, address: generateAddress().toString('hex')}
            ];
            concilium = factory.ConciliumPos.create(11, 1e3, 100, arrMembers);

            assert.deepEqual(concilium.getAddresses(false), [
                arrMembers[0].address,
                arrMembers[1].address
            ]);
        });

        it('should keep original array, even after sorting address', async () => {
            const arrMembers=[
                {amount: 1e3, address: generateAddress().toString('hex')},
                {amount: 1e5, address: generateAddress().toString('hex')}
            ];
            concilium = factory.ConciliumPos.create(11, 1e3, 100, arrMembers);

            concilium.getAddresses(false, true);

            assert.deepEqual(
                concilium._data.arrMembers.map(objRecord => objRecord.address.toString('hex')),
                [arrMembers[0].address, arrMembers[1].address]
            );
        });

        describe('quorum', function() {
            it('should be less than one ', async () => {
                assert.isOk(concilium.getQuorum() < 1);
            });

            it('should be equal to one', async () => {
                concilium = factory.ConciliumPos.create(11, 1e3, 100,
                    [
                        {amount: 3e8, address: generateAddress().toString('hex')}
                    ]
                );

                assert.isOk(concilium.getQuorum() === 1);
            });

            it('should be a bit more than half', async () => {
                concilium = factory.ConciliumPos.create(11, 1e3, 100,
                    [
                        {amount: 1e3, address: generateAddress().toString('hex')},
                        {amount: 1e5, address: generateAddress().toString('hex')},
                        {amount: 1e5, address: generateAddress().toString('hex')},
                        {amount: 1e5, address: generateAddress().toString('hex')},
                        {amount: 1e5, address: generateAddress().toString('hex')}
                    ]
                );

                assert.isOk(concilium.getQuorum() > 0.5 && concilium.getQuorum() < 1);
            });
        });

        describe('nextRound', async () => {
            it('should increase roundNo', async () => {
                concilium.initRounds();
                const nPrevRound = concilium.getRound();

                concilium.nextRound();

                assert.notEqual(nPrevRound, concilium.getRound());
            });

            it('should just increase round', async () => {
                concilium.initRounds();
                concilium.initRounds = sinon.fake();

                concilium.nextRound();

                assert.isNotOk(concilium.initRounds.calledOnce);
            });

            it('should reInit', async () => {
                concilium.initRounds();
                concilium._nLocalRound = concilium._nSeqLength;

                concilium.initRounds = sinon.fake();
                concilium.nextRound();

                assert.isOk(concilium.initRounds.calledOnce);
            });
        });

        describe('_findIdxByRound', async () => {
            let concilium;
            beforeEach(async () => {
                concilium = factory.ConciliumPos.create(11, 1, 100,
                    [
                        {amount: 3, address: generateAddress().toString('hex')},
                        {amount: 15, address: generateAddress().toString('hex')},
                        {amount: 1000, address: generateAddress().toString('hex')}
                    ]
                );
            });

            it('should be equal 0', async () => {
                assert.equal(concilium._findIdxByRound(0), 0);
                assert.equal(concilium._findIdxByRound(1), 0);
                assert.equal(concilium._findIdxByRound(2), 0);
                assert.equal(concilium._findIdxByRound(1018), 0);
            });

            it('should be equal 1', async () => {
                assert.equal(concilium._findIdxByRound(3), 1);
                assert.equal(concilium._findIdxByRound(4), 1);
                assert.equal(concilium._findIdxByRound(15), 1);
                assert.equal(concilium._findIdxByRound(17), 1);
            });

            it('should be equal 2', async () => {
                assert.equal(concilium._findIdxByRound(18), 2);
                assert.equal(concilium._findIdxByRound(19), 2);
                assert.equal(concilium._findIdxByRound(100), 2);
                assert.equal(concilium._findIdxByRound(1000), 2);
                assert.equal(concilium._findIdxByRound(1017), 2);
            });
        });

        describe('fair proposer selection', async () => {
            it('should work for 2 equal node', async () => {
                concilium = factory.ConciliumPos.create(
                    11, 10, 100,
                    [
                        {amount: 10, address: 'addr1'},
                        {amount: 10, address: 'addr2'}
                    ]
                );

                const objCounters = {};

                concilium.initRounds();
                const nTotalRound = 100000;
                for (let i = 0; i < nTotalRound; i++) {
                    const strAddr = concilium.getProposerAddress();
                    if (!objCounters[strAddr]) {
                        objCounters[strAddr] = 1;
                    } else {
                        objCounters[strAddr]++;
                    }

                    if (!(i % 20)) concilium.changeSeed(parseInt(generateSeed(nTotalRound)));
                    concilium.nextRound();
                }

                assert.isOk(objCounters['addr1'] / objCounters['addr2'] < 1.02);
                console.dir(objCounters, {colors: true, depth: null});
            });

            it('should work for 2 of 3 equal node', async () => {
                concilium = factory.ConciliumPos.create(
                    11, 1, 100,
                    [
                        {amount: 1000, address: 'addr1'},
                        {amount: 100, address: 'addr2'},
                        {amount: 1000, address: 'addr3'}
                    ]
                );

                const objCounters = {};

                concilium.initRounds();
                const nTotalRound = 100000;
                for (let i = 0; i < nTotalRound; i++) {
                    const strAddr = concilium.getProposerAddress();
                    if (!objCounters[strAddr]) {
                        objCounters[strAddr] = 1;
                    } else {
                        objCounters[strAddr]++;
                    }

                    if (!(i % 20)) concilium.changeSeed(parseInt(generateSeed(nTotalRound)));
                    concilium.nextRound();
                }
                console.dir(objCounters, {colors: true, depth: null});

                assert.isOk(objCounters['addr2'] / objCounters['addr1'] < 0.12);
                assert.isOk(objCounters['addr1'] / objCounters['addr3'] < 1.02);
            });

            it('should work for 3 unequal node', async () => {
                concilium = factory.ConciliumPos.create(
                    11, 1, 100,
                    [
                        {amount: 1, address: 'addr1'},
                        {amount: 999, address: 'addr2'},
                        {amount: 10000, address: 'addr3'}

                    ]
                );

                const objCounters = {};

                concilium.initRounds();
                const nTotalRound = 100000;
                for (let i = 0; i < nTotalRound; i++) {
                    const strAddr = concilium.getProposerAddress();
                    if (!objCounters[strAddr]) {
                        objCounters[strAddr] = 1;
                    } else {
                        objCounters[strAddr]++;
                    }

                    if (!(i % 20)) concilium.changeSeed(parseInt(generateSeed(nTotalRound)));
                    concilium.nextRound();
                }

                console.dir(objCounters, {colors: true, depth: null});
                assert.isOk(objCounters['addr1'] / objCounters['addr2'] < 0.02);
                assert.isOk(objCounters['addr2'] / objCounters['addr3'] < 0.12);
            });

            it('should work for 2 very big amount', async () => {
                concilium = factory.ConciliumPos.create(
                    11, 1, 100,
                    [
                        {amount: 1180049356, address: 'addr1'},
                        {amount: 1201634894, address: 'addr2'}
                    ]
                );

                const objCounters = {};

                concilium.initRounds();
                const nTotalRound = 100000;
                for (let i = 0; i < nTotalRound; i++) {
                    if (!(i % 20)) concilium.changeSeed(parseInt(generateSeed(nTotalRound)));
                    concilium.nextRound();

                    const strAddr = concilium.getProposerAddress();
                    if (!objCounters[strAddr]) {
                        objCounters[strAddr] = 1;
                    } else {
                        objCounters[strAddr]++;
                    }
                }

                console.dir(objCounters, {colors: true, depth: null});
                const nRatio = objCounters['addr1'] / objCounters['addr2'];

                // shares already are differ by 0.02
                assert.isOk(nRatio < 1.01 && nRatio > 0.96);
            });

            it('should work for 3 very big amount', async () => {
                concilium = factory.ConciliumPos.create(
                    11, 1, 100,
                    [
                        {amount: 1180049356, address: 'addr1'},
                        {amount: 1201634894, address: 'addr2'},
                        {amount: 100000000, address: 'addr3'}
                    ]
                );

                const objCounters = {};

                concilium.initRounds();
                const nTotalRound = 100000;
                for (let i = 0; i < nTotalRound; i++) {
                    if (!(i % 20)) concilium.changeSeed(parseInt(generateSeed(nTotalRound)));
                    concilium.nextRound();

                    const strAddr = concilium.getProposerAddress();
                    if (!objCounters[strAddr]) {
                        objCounters[strAddr] = 1;
                    } else {
                        objCounters[strAddr]++;
                    }
                }

                console.dir(objCounters, {colors: true, depth: null});
                const nRatio1 = objCounters['addr1'] / objCounters['addr2'];
                const nRatio2 = objCounters['addr2'] / objCounters['addr3'];

                // shares already are differ by 0.02
                assert.isOk(nRatio1 < 1.01 && nRatio1 > 0.96);
                assert.isOk(nRatio2 < 13 && nRatio2 > 11);
            });
        });

    });
});
