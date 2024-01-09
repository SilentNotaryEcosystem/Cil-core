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

const sleep = delay => {
    return new Promise(resolve => {
        setTimeout(() => resolve(), delay);
    });
};

let contract;
let addrCurrentOwner;

describe('Concilium contract', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function () {
        this.timeout(15000);
    });

    beforeEach(async () => {
        global.value = 1e8;
        global.callerAddress = addrCurrentOwner = generateAddress().toString('hex');
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
            const concilium = factory.ConciliumPos.create(11, 1e3, 100, [
                {amount: 1e3, address: generateAddress().toString('hex')},
                {amount: 1e5, address: generateAddress().toString('hex')}
            ]);
            global.value = 0;

            assert.throws(
                () => contract._validateConcilium(concilium.toObject()),
                'Not enough coins were sent co create such concilium'
            );
        });

        it('should fail: not enough coins', async () => {
            contract.setFeeCreate(1e5);
            const concilium = factory.ConciliumPos.create(11, 1e3, 100, [
                {amount: 1e3, address: generateAddress().toString('hex')},
                {amount: 1e5, address: generateAddress().toString('hex')}
            ]);
            global.value = 1e3 + 1e5;

            assert.throws(
                () => contract._validateConcilium(concilium.toObject()),
                'Not enough coins were sent co create such concilium'
            );
        });
        it('should pass', async () => {
            const feeCreate = 1e5;
            contract.setFeeCreate(feeCreate);
            const concilium = factory.ConciliumPos.create(11, 1e3, 100, [
                {amount: 1e3, address: generateAddress().toString('hex')},
                {amount: 1e5, address: generateAddress().toString('hex')}
            ]);
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

    describe('_disallowContractCreation', function () {
        it('should set for omited parameters', async () => {
            const concilium = factory.ConciliumRr.create(11, []);

            contract._disallowContractCreation(concilium.toObject());

            assert.equal(concilium.getFeeContractCreation(), 1e11);
            assert.equal(concilium.getFeeTxSize(), undefined);
        });

        it('should set for full parameters (override)', async () => {
            const concilium = new factory.ConciliumRr({
                addresses: [],
                conciliumId: 11,
                quorum: 2,
                parameters: {
                    fees: {
                        feeTxSize: 7,
                        feeContractCreation: 1
                    }
                }
            });
            assert.equal(concilium.getFeeContractCreation(), 1);
            assert.equal(concilium.getFeeTxSize(), 7);

            contract._disallowContractCreation(concilium.toObject());

            assert.equal(concilium.getFeeContractCreation(), 1e11);
            assert.equal(concilium.getFeeTxSize(), 7);
        });

        it('should set for partial parameters', async () => {
            const concilium = new factory.ConciliumRr({
                addresses: [],
                conciliumId: 11,
                quorum: 2,
                parameters: {}
            });

            contract._disallowContractCreation(concilium.toObject());

            assert.equal(concilium.getFeeContractCreation(), 1e11);
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

            // neither consilium owner nor creator
            global.callerAddress = generateAddress().toString('hex');

            assert.throws(
                () => contract._checkCreator(concilium.toObject(), generateAddress().toString('hex')),
                'Unauthorized call'
            );
        });

        it('should _checkCreator', async () => {
            const concilium = factory.ConciliumPos.create(11, 1e8, 100, []);
            await contract.createConcilium(concilium.toObject());

            // consilium owner creator
            assert.doesNotThrow(() => contract._checkCreator(concilium.toObject(), global.callerAddress));
        });

        it('should allow consilium owner override creator', async () => {
            global.callerAddress = generateAddress().toString('hex');
            const concilium = factory.ConciliumPos.create(11, 1e8, 100, []);
            await contract.createConcilium(concilium.toObject());

            global.callerAddress = addrCurrentOwner;
            assert.doesNotThrow(() => contract._checkCreator(concilium.toObject(), generateAddress().toString('hex')));
        });

        it('should prevent subsequent create', async () => {
            const concilium = factory.ConciliumPos.create(11, 1e8, 100, []);
            assert.equal(contract._feeCreate, 1e5);

            await contract.createConcilium(concilium.toObject());

            assert.equal(contract._feeCreate, 1e11);
        });

        it('should call _disallowContractCreation', async () => {
            global.callerAddress = generateAddress().toString('hex');
            const concilium = factory.ConciliumPos.create(11, 1e8, 100, []);
            contract._disallowContractCreation = sinon.fake();
            await contract.createConcilium(concilium.toObject());

            global.callerAddress = addrCurrentOwner;
            assert.doesNotThrow(() => contract._checkCreator(concilium.toObject(), generateAddress().toString('hex')));
            assert.isOk(contract._disallowContractCreation.calledOnce);
        });

        it('should fail with unsigned call', async () => {
            global.callerAddress = undefined;
            const concilium = factory.ConciliumPos.create(11, 1e8, 100, []);

            return assert.isRejected(contract.createConcilium(concilium.toObject()), 'Sign transaction!');
        });
    });

    describe('Join concilium', async () => {
        beforeEach(() => {
            contract.setFeeCreate(1e5);
            global.value = 1e5;
        });

        it('should fail to join with unsigned TX', async () => {
            const concilium = new factory.ConciliumRr({
                isOpen: false,
                conciliumId: 14
            });
            await contract.createConcilium(concilium.toObject());

            global.callerAddress = undefined;
            return assert.isRejected(contract.joinConcilium(1), 'Sign transaction!');
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

            return assert.isRejected(contract.joinConcilium('test'), 'Bad conciliumId');
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
            assert.isOk(contract._getPosConciliumMember(storedConcilium, global.callerAddress));
        });

        it('should reJoin ConciliumPoS (increase amount)', async () => {
            const concilium = new factory.ConciliumPos({
                isOpen: true,
                conciliumId: 1,
                nMinAmountToJoin: 1e5
            });
            await contract.createConcilium(concilium.toObject());
            await contract.joinConcilium(1);

            // rejoin
            global.block = {height: 800};
            await contract.joinConcilium(1);

            const storedConcilium = contract._checkConciliumId(1);
            const objMember = contract._getPosConciliumMember(storedConcilium, global.callerAddress);

            assert.equal(objMember.amount, 2 * global.value);
            assert.equal(
                objMember.nHeightToRelease,
                global.block.height + factory.Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON
            );
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

            assert.throws(
                () => contract._retireRrConciliumMember(concilium.toObject(), callerAddress),
                'You arent member'
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

            assert.throws(() => contract._retirePosConciliumMember(concilium.toObject()), 'You arent member');
        });

        it('should throw: too early', async () => {
            global.block.height = 100 + factory.Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON - 1;

            assert.throws(
                () => contract._retirePosConciliumMember(concilium.toObject(), arrMembers[0].address),
                'Dont leave us now'
            );
        });

        it('should pass', async () => {
            const nIdxToLeave = 1;
            global.block.height = 100 + factory.Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON + 1;
            global.send = sinon.fake();

            contract._retirePosConciliumMember(concilium.toObject(), arrMembers[nIdxToLeave].address);

            assert.isOk(global.send.calledOnce);
            arrMembers.splice(nIdxToLeave, 1);
            assert.isOk(
                arrayEquals(
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
            global.callerAddress = generateAddress().toString('hex');

            arrMembers = [
                generateAddress().toString('hex'),
                generateAddress().toString('hex'),
                generateAddress().toString('hex')
            ];
            concilium = factory.ConciliumRr.create(11, arrMembers);
        });

        it('should FAIL (not an owner)', async () => {
            await contract.createConcilium(concilium.toObject());
            global.callerAddress = generateAddress().toString('hex');

            return assert.isRejected(
                contract.inviteToConcilium(1, [generateAddress().toString('hex')]),
                'Unauthorized call'
            );
        });

        it('should FAIL: concilium is open', async () => {
            const concilium = new factory.ConciliumRr({
                isOpen: true,
                conciliumId: 1
            });
            await contract.createConcilium(concilium.toObject());

            return assert.isRejected(
                contract.inviteToConcilium(1, generateAddress().toString('hex')),
                'This concilium is open, just join it'
            );
        });

        it('should invite to RR concilium', async () => {
            const concilium = new factory.ConciliumRr({
                isOpen: false,
                conciliumId: 1
            });
            await contract.createConcilium(concilium.toObject());

            contract.inviteToConcilium(1, [generateAddress().toString('hex')]);

            const storedConcilium = new factory.ConciliumRr(contract._checkConciliumId(1));
            assert.strictEqual(storedConcilium.getMembersCount(), 1);
        });

        it('should FAIL to invite to PoS concilium', async () => {
            const concilium = new factory.ConciliumPos({
                isOpen: false,
                conciliumId: 1,
                nMinAmountToJoin: 1e4
            });
            await contract.createConcilium(concilium.toObject());

            contract.inviteToConcilium(1, [generateAddress().toString('hex')]);

            const storedConcilium = new factory.ConciliumPos(contract._checkConciliumId(1));
            assert.strictEqual(storedConcilium.getMembersCount(), 1);
        });

        it('should invite to PoS concilium', async () => {
            const concilium = new factory.ConciliumPos({
                isOpen: false,
                conciliumId: 1,
                nMinAmountToJoin: 1e4
            });
            await contract.createConcilium(concilium.toObject());

            contract.inviteToConcilium(1, [generateAddress().toString('hex'), generateAddress().toString('hex')]);

            const storedConcilium = new factory.ConciliumPos(contract._checkConciliumId(1));
            assert.strictEqual(storedConcilium.getMembersCount(), 2);
        });

        it('should reInvite ConciliumPoS (increase amount)', async () => {
            const concilium = new factory.ConciliumPos({
                isOpen: false,
                conciliumId: 1,
                nMinAmountToJoin: 1e4
            });
            await contract.createConcilium(concilium.toObject());
            const strAddrMember = generateAddress().toString('hex');

            contract.inviteToConcilium(1, [strAddrMember, generateAddress().toString('hex')]);

            // rejoin
            global.block = {height: 800};
            contract.inviteToConcilium(1, [strAddrMember, generateAddress().toString('hex')]);

            const storedConcilium = contract._checkConciliumId(1);
            const objMember = contract._getPosConciliumMember(storedConcilium, strAddrMember);

            assert.equal(objMember.amount, global.value);
            assert.equal(
                objMember.nHeightToRelease,
                global.block.height + factory.Constants.concilium.HEIGHT_TO_RELEASE_ADD_ON
            );

            const cConcilium = new factory.ConciliumPos(storedConcilium);
            assert.strictEqual(cConcilium.getMembersCount(), 3);
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
            assert.isNotOk(contract._getPosConciliumMember(storedConcilium, global.callerAddress));
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
        it('should fail for unsigned', async () => {
            const concilium = new factory.ConciliumRr({
                isOpen: true
            });
            contract.setFeeCreate(1e2);
            await contract.createConcilium(concilium.toObject());
            global.callerAddress = undefined;

            return assert.isRejected(contract.changeConciliumParameters(1, {}), 'Sign transaction!');
        });
        it('should fail for 3d party', async () => {
            const concilium = new factory.ConciliumRr({
                isOpen: true
            });
            contract.setFeeCreate(1e2);
            await contract.createConcilium(concilium.toObject());
            global.callerAddress = generateAddress().toString();

            return assert.isRejected(contract.changeConciliumParameters(1, {}), 'Unauthorized call');
        });
        it('should _disallowContractCreation for non owner', async () => {
            const concilium = new factory.ConciliumRr({
                isOpen: true
            });
            contract.setFeeCreate(1e2);
            global.callerAddress = generateAddress().toString('hex');
            await contract.createConcilium(concilium.toObject());
            contract._disallowContractCreation = sinon.fake();

            await contract.changeConciliumParameters(1, {});

            assert.isOk(contract._disallowContractCreation.calledOnce);
        });

        it('should record tx with changes to concilium', async () => {
            const concilium = new factory.ConciliumRr({
                isOpen: true
            });
            contract.setFeeCreate(1e2);
            await contract.createConcilium(concilium.toObject());
            contract._rrConciliumMemberExists = sinon.fake.returns(true);

            await contract.changeConciliumParameters(1, {});

            const storedConcilium = contract._checkConciliumId(1);
            assert.isOk(Array.isArray(storedConcilium.parameterTXNs) && storedConcilium.parameterTXNs.length === 1);
            assert.strictEqual(storedConcilium.parameterTXNs[0], contractTx);
        });
        it('should set fees (whole reset)', async () => {
            const nNewFee = 111;
            const objNewParameters = {
                fees: {
                    feeTxSize: nNewFee,
                    feeContractCreation: nNewFee,
                    feeContractInvocation: nNewFee,
                    feeStorage: nNewFee
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
            assert.equal(storedConcilium.getFeeTxSize(), nNewFee);
            assert.equal(storedConcilium.getFeeContractCreation(), nNewFee);
            assert.equal(storedConcilium.getFeeContractInvocation(), nNewFee);
            assert.equal(storedConcilium.getFeeStorage(), nNewFee);
        });

        it('should set fees (change only one)', async () => {
            const nOldFee = 120;
            const nNewFeeTxSize = 111;
            const strDocHash = 'cf60920089b7db942206e6484ea7df51b01e7b1f77dd99c1ecdc766cf5c6a77a';

            const objNewParameters = {
                fees: {
                    feeTxSize: nNewFeeTxSize
                }
            };
            const concilium = new factory.ConciliumPos({
                isOpen: true,
                nMinAmountToJoin: 1e5,
                parameters: {
                    fees: {
                        feeTxSize: nOldFee,
                        feeContractCreation: nOldFee,
                        feeContractInvocation: nOldFee,
                        feeStorage: nOldFee
                    },
                    document: strDocHash
                }
            });
            contract.setFeeCreate(1e2);
            await contract.createConcilium(concilium.toObject());
            contract._posConciliumMemberExists = sinon.fake.returns(true);

            await contract.changeConciliumParameters(1, objNewParameters);

            const storedConcilium = new factory.ConciliumPos(contract._checkConciliumId(1));
            assert.equal(storedConcilium.getFeeTxSize(), nNewFeeTxSize);

            // should keep everything else
            assert.equal(storedConcilium.getFeeContractCreation(), nOldFee);
            assert.equal(storedConcilium.getFeeContractInvocation(), nOldFee);
            assert.equal(storedConcilium.getFeeStorage(), nOldFee);

            assert.strictEqual(storedConcilium.getDocument(), strDocHash);
        });

        it('should replace document (keep everything else)', async () => {
            const nOldFee = 120;
            const strOldDocHash = 'cb7ada0c4cddbb79374b2b433c1432203f092a388eef084d9d0c146a970affdc';
            const strNewDocHash = 'cf60920089b7db942206e6484ea7df51b01e7b1f77dd99c1ecdc766cf5c6a77a';
            const objNewParameters = {
                document: strNewDocHash
            };
            const concilium = new factory.ConciliumPos({
                isOpen: true,
                nMinAmountToJoin: 1e5,
                parameters: {
                    fees: {
                        feeTxSize: nOldFee,
                        feeContractCreation: nOldFee,
                        feeContractInvocation: nOldFee,
                        feeStorage: nOldFee
                    },
                    document: strOldDocHash
                }
            });
            contract.setFeeCreate(1e2);
            await contract.createConcilium(concilium.toObject());
            contract._posConciliumMemberExists = sinon.fake.returns(true);

            await contract.changeConciliumParameters(1, objNewParameters);

            const storedConcilium = new factory.ConciliumPos(contract._checkConciliumId(1));
            assert.strictEqual(storedConcilium.getDocument(), strNewDocHash);

            // should keep everything else
            assert.equal(storedConcilium.getFeeTxSize(), nOldFee);
            assert.equal(storedConcilium.getFeeContractCreation(), nOldFee);
            assert.equal(storedConcilium.getFeeContractInvocation(), nOldFee);
            assert.equal(storedConcilium.getFeeStorage(), nOldFee);
        });

        it('should disable concilium', async () => {
            const objNewParameters = {
                isEnabled: false
            };

            const concilium = new factory.ConciliumPos({
                isOpen: true,
                nMinAmountToJoin: 1e5,
                parameters: {
                    fees: 'fakeFees',
                    isEnabled: true
                }
            });

            contract.setFeeCreate(1e2);
            await contract.createConcilium(concilium.toObject());
            contract._posConciliumMemberExists = sinon.fake.returns(true);

            await contract.changeConciliumParameters(1, objNewParameters);

            const storedConcilium = new factory.ConciliumPos(contract._checkConciliumId(1));
            assert.isNotOk(storedConcilium.isEnabled());
        });
    });
});
