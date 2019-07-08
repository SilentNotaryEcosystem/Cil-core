'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const sinon = require('sinon');

const factory = require('./testFactory');
const {pseudoRandomBuffer, generateAddress} = require('./testUtil');

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

    });
});
