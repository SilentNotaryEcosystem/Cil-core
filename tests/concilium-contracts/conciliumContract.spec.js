'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
chai.use(require('chai-as-promised'));
const {assert} = chai;
const sinon = require('sinon');

const Contract = require('./conciliumContract');
const factory = require('../testFactory');

const {arrayEquals} = require('../../utils');
const {generateAddress, pseudoRandomBuffer} = require('../testUtil');

const sleep = (delay) => {
    return new Promise(resolve => {
        setTimeout(() => resolve(), delay);
    });
};

let contract;

describe('Concilium contract', () => {
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

        const initialConcilium = factory.ConciliumRr.create(0, [global.callerAddress]);
        contract = new Contract(initialConcilium.toObject());
    });

    describe('Constructor', async () => {
        it('should throw: no objInitialConcilium', async () => {
            assert.throws(() => new Contract(), 'Specify initial objInitialConcilium');
        });

        it('should add InitialConcilium no _feeCreate', async () => {
            const initialConcilium = factory.ConciliumRr.create(0, [global.callerAddress]);

            const contract = new Contract(initialConcilium.toObject());

            assert.isOk(contract && contract._arrConciliums.length === 1);
            assert.isNotOk(contract._feeCreate);
        });

        it('should set _feeCreate ', async () => {
            const initialConcilium = factory.ConciliumRr.create(0, [global.callerAddress]);
            const nFeeCreate = 1e4;

            const contract = new Contract(initialConcilium.toObject(), nFeeCreate);

            assert.isOk(contract && contract._feeCreate === nFeeCreate);
        });
    });

    describe('setFeeCreate', async () => {
        it('should throw: wrong owner', async () => {
            contract._ownerAddress = generateAddress().toString('hex');

            assert.throws(() => contract.setFeeCreate(1e2), 'Unauthorized call');
        });

        it('should setFeeCreate', async () => {
            contract.setFeeCreate(1e2);

            assert.equal(contract._feeCreate, 1e2);
        });
    });

    describe('_validateConcilium', async () => {
        it('should fail: not enough coins', async () => {
            contract.setFeeCreate(0);
            const concilium = factory.ConciliumPos.create(11, 1e3, 100,
                [
                    {amount: 1e3, address: generateAddress().toString('hex')},
                    {amount: 1e5, address: generateAddress().toString('hex')}
                ]
            );
            global.value = 0;

            assert.throws(() => contract._validateConcilium(concilium.toObject()),
                'Not enough coins were sent co create such concilium'
            );
        });

        it('should fail: not enough coins', async () => {
            contract.setFeeCreate(1e5);
            const concilium = factory.ConciliumPos.create(11, 1e3, 100,
                [
                    {amount: 1e3, address: generateAddress().toString('hex')},
                    {amount: 1e5, address: generateAddress().toString('hex')}
                ]
            );
            global.value = 1e3 + 1e5;

            assert.throws(() => contract._validateConcilium(concilium.toObject()),
                'Not enough coins were sent co create such concilium'
            );
        });
        it('should pass', async () => {
            const feeCreate = 1e5;
            contract.setFeeCreate(feeCreate);
            const concilium = factory.ConciliumPos.create(11, 1e3, 100,
                [
                    {amount: 1e3, address: generateAddress().toString('hex')},
                    {amount: 1e5, address: generateAddress().toString('hex')}
                ]
            );
            global.value = 1e3 + 1e5 + feeCreate;

            contract._validateConcilium(concilium.toObject());
        });

        it('should pass ConciliumPos', async () => {
            const concilium = factory.ConciliumPos.create(11, 1e8, 100, []);

            contract._validateConcilium(concilium.toObject());
        });

        it('should pass ConciliumRr', async () => {
            const concilium = factory.ConciliumRr.create(11, []);

            contract._validateConcilium(concilium.toObject());
        });
    });

    describe('_checkFeeCreate', async () => {
        it('should fail: fee unset', async () => {
            assert.throws(() => contract._checkFeeCreate(1e6), 'Set _feeCreate first');
        });

        it('should fail: fee too small', async () => {
            contract.setFeeCreate(1e10);
            assert.throws(() => contract._checkFeeCreate(1e8), 'Not enough funds');
        });
    });

    describe('createConcilium', async () => {
        beforeEach(() => {
            contract.setFeeCreate(1e5);
            global.value = 1e5;
        });

        it('should create POS', async () => {
            const concilium = factory.ConciliumPos.create(11, 1e8, 100, []);

            await contract.createConcilium(concilium.toObject());

            assert.equal(contract._arrConciliums.length, 2);
        });

        it('should create RR', async () => {
            const concilium = factory.ConciliumRr.create(11, []);

            await contract.createConcilium(concilium.toObject());

            assert.equal(contract._arrConciliums.length, 2);
        });

        it('should fail to _checkCreator', async () => {
            const concilium = factory.ConciliumPos.create(11, 1e8, 100, []);

            await contract.createConcilium(concilium.toObject());

            assert.throws(() => contract._checkCreator(
                concilium.toObject(), generateAddress().toString('hex')),
                'Unauthorized call'
            );
        });

        it('should _checkCreator', async () => {
            const concilium = factory.ConciliumPos.create(11, 1e8, 100, []);

            await contract.createConcilium(concilium.toObject());

            assert.doesNotThrow(() => contract._checkCreator(concilium.toObject(), global.callerAddress));
        });
    });

    describe('Join concilium', async () => {
        beforeEach(() => {
            contract.setFeeCreate(1e5);
            global.value = 1e5;
        });

        it('should fail to join  conciliumId = 0', async () => {
            const concilium = new factory.ConciliumRr({
                isOpen: false,
                conciliumId: 14
            });
            await contract.createConcilium(concilium.toObject());

            return assert.isRejected(contract.joinConcilium(0), 'Invalid concilium');
        });

        it('should fail to join conciliumId not a number', async () => {
            const concilium = new factory.ConciliumRr({
                isOpen: false,
                conciliumId: 14
            });
            await contract.createConcilium(concilium.toObject());

            return assert.isRejected(contract.joinConcilium('test'), 'Invalid concilium');
        });

        it('should fail to join: wrong conciliumId', async () => {
            const concilium = new factory.ConciliumRr({
                isOpen: false,
                conciliumId: 14
            });
            await contract.createConcilium(concilium.toObject());

            return assert.isRejected(contract.joinConcilium(14), 'Bad conciliumId');
        });

        it('should fail to join closed Concilium', async () => {
            const concilium = new factory.ConciliumRr({
                isOpen: false,
                conciliumId: 1
            });
            await contract.createConcilium(concilium.toObject());

            return assert.isRejected(contract.joinConcilium(1), 'You cant join this concilium. Ask about invitation');
        });

        it('should join ConciliumRr', async () => {
            const concilium = new factory.ConciliumRr({
                isOpen: true,
                conciliumId: 1
            });
            await contract.createConcilium(concilium.toObject());

            await contract.joinConcilium(1);

            const storedConcilium = contract._checkConciliumId(1);
            assert.isOk(contract._rrConciliumMemberExists(storedConcilium, global.callerAddress));
        });

        it('should fail join ConciliumRr: already member', async () => {
            const concilium = new factory.ConciliumRr({
                isOpen: true,
                conciliumId: 1
            });
            await contract.createConcilium(concilium.toObject());

            await contract.joinConcilium(1);
            return assert.isRejected(contract.joinConcilium(1), 'already joined');
        });

        it('should join ConciliumPoS', async () => {
            const concilium = new factory.ConciliumPos({
                isOpen: true,
                conciliumId: 1,
                nMinAmountToJoin: 1e5
            });
            await contract.createConcilium(concilium.toObject());

            await contract.joinConcilium(1);

            const storedConcilium = contract._checkConciliumId(1);
            assert.isOk(contract._posConciliumMemberExists(storedConcilium, global.callerAddress));
        });

        it('should fail join ConciliumPoS: already member', async () => {
            const concilium = new factory.ConciliumPos({
                isOpen: true,
                conciliumId: 1,
                nMinAmountToJoin: 1e5
            });
            await contract.createConcilium(concilium.toObject());

            await contract.joinConcilium(1);
            return assert.isRejected(contract.joinConcilium(1), 'already joined');
        });
    });

    describe('_retireRrConciliumMember', async () => {
        let arrMembers = [];
        let concilium;

        beforeEach(() => {
            contract.setFeeCreate(1e5);
            global.value = 1e5;

            arrMembers = [
                generateAddress().toString('hex'),
                generateAddress().toString('hex'),
                generateAddress().toString('hex')
            ];
            concilium = factory.ConciliumRr.create(11, arrMembers);
        });

        it('should throw: not a member', async () => {
            const callerAddress = generateAddress().toString('hex');

            assert.throws(() => contract._retireRrConciliumMember(concilium.toObject(), callerAddress),
                'You aren\'t member'
            );
        });

        it('should pass', async () => {
            contract._retireRrConciliumMember(concilium.toObject(), arrMembers[0]);

            assert.isOk(arrayEquals(concilium.getAddresses(false), arrMembers.slice(1)));
        });
    });

    describe('_retirePosConciliumMember', async () => {
        let arrMembers = [];
        let concilium;

        beforeEach(() => {
            contract.setFeeCreate(1e5);
            global.value = 1e5;

            arrMembers = [
                {address: generateAddress().toString('hex'), amount: 1e6},
                {address: generateAddress().toString('hex'), amount: 5e6},
                {address: generateAddress().toString('hex'), amount: 7e6}
            ];
            concilium = factory.ConciliumPos.create(11, 1e5, 100, arrMembers);
        });

        it('should throw: not a member', async () => {
            global.callerAddress = generateAddress().toString('hex');

            assert.throws(() => contract._retirePosConciliumMember(concilium.toObject()), 'You aren\'t member');
        });

        it('should throw: too early', async () => {
            global.block.height = 100 + factory.Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON - 1;

            assert.throws(() => contract._retirePosConciliumMember(concilium.toObject(), arrMembers[0].address),
                'Don\'t leave us now'
            );
        });

        it('should pass', async () => {
            const nIdxToLeave = 1;
            global.block.height = 100 + factory.Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON + 1;
            global.send = sinon.fake();

            contract._retirePosConciliumMember(concilium.toObject(), arrMembers[nIdxToLeave].address);

            assert.isOk(global.send.calledOnce);
            arrMembers.splice(nIdxToLeave, 1);
            assert.isOk(arrayEquals(
                concilium.getAddresses(false),
                arrMembers.map(objRecord => objRecord.address)
                )
            );
        });
    });

    describe('Proxying calls', async () => {
        it('should fail to set proxy: bad address', async () => {
            assert.throws(() => contract.setProxy('123'));
        });

        it('should fail to set proxy: not owner', async () => {
            global.callerAddress = generateAddress().toString('hex');

            assert.throws(() => contract.setProxy(generateAddress().toString()));
        });

        it('should set address', async () => {
            const strNewAddress = generateAddress().toString('hex');
            contract.setProxy(strNewAddress);

            assert.equal(contract._proxyAddress, strNewAddress);
        });

        describe('should use new address for calls', async () => {
            beforeEach(() => {
                const strNewAddress = generateAddress().toString('hex');
                contract.setProxy(strNewAddress);
                global.delegatecall = sinon.fake();
            });

            it('should use it for "createConcilium"', async () => {
                contract.setFeeCreate(1e2);

                await contract.createConcilium({});

                assert.isOk(global.delegatecall.calledOnce);
            });

            it('should use it for "joinConcilium"', async () => {
                await contract.joinConcilium(0);

                assert.isOk(global.delegatecall.calledOnce);
            });

            it('should use it for "leaveConcilium"', async () => {
                await contract.leaveConcilium({});

                assert.isOk(global.delegatecall.calledOnce);
            });

            it('should use it for "inviteToConcilium"', async () => {
                await contract.inviteToConcilium(0, generateAddress().toString('hex'));

                assert.isOk(global.delegatecall.calledOnce);
            });
        });
    });

    describe('Invite to concilium', async () => {
        let arrMembers = [];
        let concilium;

        beforeEach(() => {
            contract.setFeeCreate(1e5);
            global.value = 1e5;

            arrMembers = [
                generateAddress().toString('hex'),
                generateAddress().toString('hex'),
                generateAddress().toString('hex')
            ];
            concilium = factory.ConciliumRr.create(11, arrMembers);
        });

        it('should fail: concilium is open', async () => {
            const concilium = new factory.ConciliumRr({
                isOpen: true,
                conciliumId: 1,
                nMinAmountToJoin: 1e5
            });
            await contract.createConcilium(concilium.toObject());

            return assert.isRejected(
                contract.inviteToConcilium(1, generateAddress().toString('hex')),
                'This concilium is open, just join it'
            );
        });
    });
    describe('Leave concilium', async () => {
        it('should leave RR concilium', async () => {
            const concilium = new factory.ConciliumRr({
                isOpen: true,
                conciliumId: 1
            });
            contract.setFeeCreate(1e2);
            await contract.createConcilium(concilium.toObject());
            await contract.joinConcilium(1);

            await contract.leaveConcilium(1);

            const storedConcilium = contract._checkConciliumId(1);
            assert.isNotOk(contract._rrConciliumMemberExists(storedConcilium, global.callerAddress));
        });

        it('should leave PoS concilium', async () => {
            const concilium = new factory.ConciliumPos({
                isOpen: true,
                conciliumId: 1,
                nMinAmountToJoin: 1e5
            });
            contract.setFeeCreate(1e2);
            await contract.createConcilium(concilium.toObject());
            global.block.height = 100;
            await contract.joinConcilium(1);
            global.block.height = 100 + factory.Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON + 1;

            await contract.leaveConcilium(1);

            const storedConcilium = contract._checkConciliumId(1);
            assert.isNotOk(contract._posConciliumMemberExists(storedConcilium, global.callerAddress));
        });
    });

    describe('Constant method getHeightToRelease', async () => {
        it('should get height', async () => {
            const concilium = new factory.ConciliumPos({
                isOpen: true,
                conciliumId: 1,
                nMinAmountToJoin: 1e5
            });
            contract.setFeeCreate(1e2);
            await contract.createConcilium(concilium.toObject());
            global.block.height = 100;
            await contract.joinConcilium(1);

            const height = await contract.getHeightToRelease(1);

            assert.equal(height, global.block.height + factory.Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON);
        });
    });

    describe('Change parameters', async () => {
        it('should set fees', async () => {
            const objNewParameters = {
                fees: {
                    feeTxSize: 111,
                    feeContractCreation: 111,
                    feeContractInvocation: 111,
                    feeStorage: 111
                }
            };

            const concilium = new factory.ConciliumPos({
                isOpen: true,
                nMinAmountToJoin: 1e5
            });
            contract.setFeeCreate(1e2);
            await contract.createConcilium(concilium.toObject());
            contract._posConciliumMemberExists = sinon.fake.returns(true);

            await contract.changeConciliumParameters(1, objNewParameters);

            const storedConcilium = new factory.ConciliumPos(contract._checkConciliumId(1));
            assert.equal(storedConcilium.getFeeTxSize(), 111);
        });
    });
});
