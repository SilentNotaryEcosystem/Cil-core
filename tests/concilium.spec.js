'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('./testFactory');
const {pseudoRandomBuffer} = require('./testUtil');

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
    });

    describe('ConciliumPoS', () => {

    });
});
