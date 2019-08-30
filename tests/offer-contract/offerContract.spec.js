'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
chai.use(require('chai-as-promised'));
const {assert} = chai;
const sinon = require('sinon');

const Contract = require('./offerContract');
const factory = require('../testFactory');

const {arrayEquals} = require('../../utils');
const {generateAddress, pseudoRandomBuffer} = require('../testUtil');

const sleep = (delay) => {
    return new Promise(resolve => {
        setTimeout(() => resolve(), delay);
    });
};

let contract;

describe('Offer contract', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    beforeEach(async () => {
        global.value = 1e8;
        global.callerAddress = generateAddress().toString('hex');
        global.contractTx = pseudoRandomBuffer().toString('hex');
        global.block = {
            height: 100
        };

        contract = new Contract();
    });

    describe('Constructor', async () => {
        it('should create without text', async () => {
            assert.isOk(contract);
            assert.isNotOk(contract.getOfferText());
        });

        it('should create with text', async () => {
            contract = new Contract('Some text');

            assert.isOk(contract);
            assert.isOk(contract.getOfferText());
        });

        it('should create with text and auto open', async () => {
            contract = new Contract('Some text', true);

            assert.isOk(contract);
            assert.isOk(contract.getOfferText());
            assert.isOk(contract.isOpen());
        });

        it('should create closed offer (since no text)', async () => {
            contract = new Contract(undefined, true);

            assert.isNotOk(contract.getOfferText());
            assert.isNotOk(contract.isOpen());
        });
    });

    describe('setText', async () => {
        it('should call, but without effect', async () => {
            assert.isNotOk(contract.getOfferText());

            contract.setText();

            assert.isNotOk(contract.getOfferText());
        });

        it('should success (constructed without offer)', async () => {
            assert.isNotOk(contract.getOfferText());

            contract.setText('text');

            assert.isOk(contract.getOfferText());
        });

        it('should FAIL (text could be set only once)', async () => {
            contract = new Contract('Some text');

            assert.throws(() => contract.setText('text'), "You can't change already published text!");
        });

    });

    describe('isOpen', async () => {
        it('should be closed (constructed without text)', async () => {
            assert.isNotOk(contract.isOpen());
        });

        it('should be closed (constructed with text)', async () => {
            contract = new Contract('Some text');

            assert.isNotOk(contract.isOpen());
        });

        it('should be closed (just text was published)', async () => {
            contract.setText('text');

            assert.isNotOk(contract.isOpen());
        });

        it('should be opened (text was published, and autoOpen set)', async () => {
            contract.setText('text', true);

            assert.isOk(contract.isOpen());
        });
    });

    describe('Close', async () => {
        it('should close (not open)', async () => {
            contract.close();

            assert.isNotOk(contract.isOpen());
        });

        it('should close', async () => {
            contract.setText('Test', true);

            contract.close();

            assert.isNotOk(contract.isOpen());
        });
    });

    describe('Open', async () => {
        it('should fail to open (no text)', async () => {
            assert.throws(() => contract.open(), "Offer contain no text!");
        });

        it('should open (not open yet)', async () => {
            contract.setText('Test', true);

            contract.open();

            assert.isOk(contract.isOpen());
        });

        it('should be able to reopen closed offer', async () => {
            contract.setText('Test', true);
            contract.close();

            contract.open();

            assert.isOk(contract.isOpen());
        });
    });

    describe('Join', async () => {
        it('should fail to join (closed offer)', async () => {
            assert.throws(() => contract.join(), "Can't join. Offer closed.");
        });

        it('should fail to join (unsigned TX)', async () => {
            contract.setText('Test', true);
            global.callerAddress = undefined;

            assert.throws(() => contract.join(), "You should sign offer.");
        });

        it('should join', async () => {
            contract.setText('Test', true);

            contract.join();

            assert.equal(contract.wasAcceptedBy(callerAddress), contractTx);
        });

        it('should fail to join (already joined)', async () => {
            contract.setText('Test', true);
            contract.join();

            assert.throws(() => contract.join(), "Already accepted");
        });
    });

    describe('OnlyOwner methods (constructor, setText, open, close)', async () => {
        beforeEach(async () => {
            global.callerAddress = generateAddress().toString('hex');
            contract = new Contract();
        });

        function replaceCaller() {

            // change address for future calls
            global.callerAddress = generateAddress().toString('hex');
        }

        it('should fail to construct', async () => {
            global.callerAddress = undefined;
            assert.throws(() => new Contract(), "You should sign offer creation!");
        });
        it('should fail for setText', async () => {
            replaceCaller();
            assert.throws(() => contract.setText('test'), 'Unauthorized call');
        });

        it('should fail for open', async () => {
            replaceCaller();
            assert.throws(() => contract.open(), 'Unauthorized call');
        });

        it('should fail for close', async () => {
            replaceCaller();
            assert.throws(() => contract.close(), 'Unauthorized call');
        });
    });
});
