'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
chai.use(require('chai-as-promised'));
const {assert} = chai;
const sinon = require('sinon');

const {Nft: Contract} = require('./nft');
const factory = require('../testFactory');

const {arrayEquals} = require('../../utils');
const {generateAddress, pseudoRandomBuffer} = require('../testUtil');

const sleep = delay => {
    return new Promise(resolve => {
        setTimeout(() => resolve(), delay);
    });
};

let contract;

describe('Nft', () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function () {
        this.timeout(15000);
    });

    beforeEach(async () => {
        global.value = 0;
        global.callerAddress = generateAddress().toString('hex');
        global.contractTx = pseudoRandomBuffer().toString('hex');
        global.block = {
            height: 100,
            hash: 'hash'
        };

        contract = new Contract();
    });

    describe('createToken', async () => {
        let objTokedParams;

        beforeEach(async () => {
            global.value = 130000;

            objTokedParams = {
                strSymbol: 'tst',
                strName: 'Test NFT token',
                strDescription: 'This is an NFT token description',
                strTokenUri: 'http://www.test.com',
                strIssuerName: 'Me'
            };
        });

        it('should create', async () => {
            contract.createToken(objTokedParams);

            const strTokenId = contract.getTokenId('TST');

            assert.isOk(contract._data[strTokenId]);
            assert.equal(contract._data[strTokenId].length, 9);
        });

        it('should throw (unsigned TX)', async () => {
            global.callerAddress = undefined;
            assert.throws(() => contract.createToken(objTokedParams), 'You should sign TX');
        });

        it('should throw (low create fee)', async () => {
            global.value = 130000 - 1;
            assert.throws(() => contract.createToken(objTokedParams), 'Create fee is 130000');
        });

        it('should throw (create twice)', async () => {
            contract.createToken(objTokedParams);
            assert.throws(() => contract.createToken(objTokedParams), `Symbol already exists`);
        });
    });

    describe('_getTokenData', async () => {
        let objTokedParams;
        let strTokenId;

        beforeEach(async () => {
            global.value = 130000;

            objTokedParams = {
                strSymbol: 'tst',
                strName: 'Test NFT token',
                strDescription: 'This is an NFT token description',
                strTokenUri: 'http://www.test.com',
                strIssuerName: 'Me'
            };

            contract.createToken(objTokedParams);
            strTokenId = contract.getTokenId('TST');
        });

        it('should throw (not existed token)', async () => {
            assert.throws(() => contract._getTokenData('FAIL'), "strTokenId doesn't exist");
        });

        it('should pass', async () => {
            const {
                strSymbol,
                strName,
                strDescription,
                strTokenUri,
                strIssuerName,
                strOwner,
                strApproved,
                strTxHashChanges
            } = contract._getTokenData(strTokenId);

            assert.isOk(strSymbol);
            assert.isOk(strName);
            assert.isOk(strDescription);
            assert.isOk(strTokenUri);
            assert.isOk(strIssuerName);
            assert.isOk(strOwner);
            assert.isNull(strApproved);
            assert.deepEqual(strTxHashChanges, 'hash');
        });
    });

    describe.skip('balanceOf', async () => {
        let objTokedParams;

        beforeEach(async () => {
            global.value = 130000;

            objTokedParams = {
                strSymbol: 'tst',
                strName: 'Test NFT token',
                strDescription: 'This is an NFT token description',
                strTokenUri: 'http://www.test.com',
                strIssuerName: 'Me'
            };
        });

        it('should be 1 for creator', async () => {
            contract.createToken(objTokedParams);
            assert.equal(contract.balanceOf(callerAddress), 1);
        });

        it('should be zero for any other address', async () => {
            contract.createToken(objTokedParams);
            assert.equal(contract.balanceOf(generateAddress().toString('hex')), 0);
        });
    });

    describe.skip('approve', async () => {
        let objTokedParams;

        beforeEach(async () => {
            global.value = 130000;

            objTokedParams = {
                strSymbol: 'tst',
                nTotalSupply: 1e5,
                strIssuerName: 'Me',
                strGoals: 'Test purposes'
            };

            contract.createToken(objTokedParams);
        });

        it('should throw (approve negative amount)', async () => {
            const strAddr = generateAddress().toString('hex');

            assert.throws(() => contract.approve('TST', strAddr, -1), `amount should be positive`);
        });

        it('should approve', async () => {
            const strAddr = generateAddress().toString('hex');

            contract.approve('TST', strAddr, 100);
        });
    });

    describe.skip('allowance', async () => {
        let objTokedParams;

        beforeEach(async () => {
            global.value = 130000;

            objTokedParams = {
                strSymbol: 'tst',
                nTotalSupply: 1e5,
                strIssuerName: 'Me',
                strGoals: 'Test purposes'
            };

            contract.createToken(objTokedParams);
        });

        it('should return 0 for non approved', async () => {
            const strAddr = generateAddress().toString('hex');

            const nAllowance = contract.allowance('TST', callerAddress, strAddr);

            assert.equal(nAllowance, 0);
        });

        it('should get allowed', async () => {
            const nApproved = 100;
            const strAddr = generateAddress().toString('hex');
            contract.approve('TST', strAddr, nApproved);

            const nAllowance = contract.allowance('TST', callerAddress, strAddr);

            assert.equal(nAllowance, nApproved);
        });
    });

    describe.skip('transferFrom', async () => {
        let objTokedParams;
        let strAddrReceiver = generateAddress().toString('hex');

        beforeEach(async () => {
            global.value = 130000;

            objTokedParams = {
                strSymbol: 'tst',
                nTotalSupply: 1e5,
                strIssuerName: 'Me',
                strGoals: 'Test purposes'
            };

            contract.createToken(objTokedParams);
        });

        it('should throw (not approved)', async () => {
            const strAddrOwner = generateAddress().toString('hex');
            const errMsg = `Allowed to transfer at most 0 of ${objTokedParams.strSymbol.toUpperCase()}`;

            assert.throws(() => contract.transferFrom('TST', strAddrOwner, strAddrReceiver, 100), errMsg);
        });

        it('should throw (not enough)', async () => {
            const strAddrOwner = callerAddress;
            const nAmountToSend = objTokedParams.nTotalSupply + 1;
            const strProxyAddr = generateAddress().toString('hex');

            contract.approve('TST', strProxyAddr, nAmountToSend);
            const errMsg = `${callerAddress} has only ${objTokedParams.nTotalSupply}`;

            callerAddress = strProxyAddr;

            assert.throws(() => contract.transferFrom('TST', strAddrOwner, strAddrReceiver, nAmountToSend), errMsg);
        });

        it('should pass', async () => {
            const strAddrOwner = callerAddress;
            const nAmountToSend = 1000;
            const strProxyAddr = generateAddress().toString('hex');
            contract.approve('TST', strProxyAddr, nAmountToSend);
            const bPrevBalance = contract.balanceOf('TST', strAddrOwner);

            callerAddress = strProxyAddr;

            contract.transferFrom('TST', strAddrOwner, strAddrReceiver, nAmountToSend);

            assert.equal(contract.balanceOf('TST', strAddrOwner), bPrevBalance - nAmountToSend);
            assert.equal(contract.balanceOf('TST', strAddrReceiver), nAmountToSend);
            assert.equal(contract.allowance('TST', strAddrOwner, strProxyAddr), 0);
        });
    });

    describe.skip('transfer', async () => {
        let objTokedParams;

        beforeEach(async () => {
            global.value = 130000;

            objTokedParams = {
                strSymbol: 'tst',
                nTotalSupply: 1e5,
                strIssuerName: 'Me',
                strGoals: 'Test purposes'
            };

            contract.createToken(objTokedParams);
        });

        it('should throw (not enough)', async () => {
            const nAmountToSend = objTokedParams.nTotalSupply + 1;
            const strAddr = generateAddress().toString('hex');
            const errMsg = `${callerAddress} has only ${objTokedParams.nTotalSupply}`;

            assert.throws(() => contract.transfer('TST', strAddr, nAmountToSend), errMsg);
        });

        it('should pass', async () => {
            const nAmountToSend = 1000;
            const strAddr = generateAddress().toString('hex');
            const bPrevBalance = contract.balanceOf('TST', callerAddress);

            contract.transfer('TST', strAddr, nAmountToSend);

            assert.equal(contract.balanceOf('TST', callerAddress), bPrevBalance - nAmountToSend);
            assert.equal(contract.balanceOf('TST', strAddr), nAmountToSend);
            assert.equal(contract.allowance('TST', callerAddress, strAddr), 0);
        });
    });

    describe.skip('direct call or private functions', async () => {
        beforeEach(async () => {
            global.bIndirectCall = false;
        });

        it('should throw for _setBalance', async () => {
            assert.throws(() => contract._setBalance(), "You aren't supposed to be here");
        });

        it('should throw for _transferFromTo', async () => {
            assert.throws(() => contract._transferFromTo(), "You aren't supposed to be here");
        });

        it('should throw for _transferFromTo', async () => {
            assert.throws(() => contract._setAllowance(), "You aren't supposed to be here");
        });

        it('should throw for _setTotalSupply', async () => {
            assert.throws(() => contract._setTotalSupply(), "You aren't supposed to be here");
        });

        it('should throw for _setFreeze', async () => {
            assert.throws(() => contract._setTotalSupply(), "You aren't supposed to be here");
        });
    });

    describe.skip('additional emission', async () => {
        const nTotalSupply = 1e5;
        const nDecimals = 5;
        beforeEach(async () => {
            global.value = 130000;
            global.callerAddress = generateAddress().toString('hex');

            const objTokedParams = {
                strSymbol: 'tst',
                nTotalSupply,
                strIssuerName: 'Me',
                strGoals: 'Test purposes',
                decimals: nDecimals
            };

            contract.createToken(objTokedParams);
        });

        it('should fail (not owner)', async () => {
            callerAddress = generateAddress().toString('hex');

            assert.throws(() => contract.emitMoreTokens('TST', 1e5), 'You arent an owner');
        });

        it('should fail (zero emission)', async () => {
            assert.throws(() => contract.emitMoreTokens('TST', 0), 'amount should be positive');
        });

        it('should emit', async () => {
            global.block.hash = 'hash2';

            const nAddon = 1e4;
            contract.emitMoreTokens('TST', nAddon);

            // Increase total supply
            const {nTotalSupply: nNewTotal, arrTxHashChanges, decimals} = contract.tokenData('TST');
            const nExpectedAmount = nTotalSupply + nAddon;
            assert.strictEqual(nNewTotal, nExpectedAmount);

            // store TX with token changes
            assert.strictEqual(arrTxHashChanges[1], global.block.hash);

            // Deposit emitted tokens to owner
            assert.strictEqual(contract.balanceOf('TST', callerAddress), nExpectedAmount);
        });
    });

    describe.skip('freeze token', async () => {
        const nTotalSupply = 1e5;
        beforeEach(async () => {
            global.value = 130000;
            global.callerAddress = generateAddress().toString('hex');

            const objTokedParams = {
                strSymbol: 'tst',
                nTotalSupply,
                strIssuerName: 'Me',
                strGoals: 'Test purposes'
            };

            contract.createToken(objTokedParams);
        });

        it('should fail (not owner)', async () => {
            callerAddress = generateAddress().toString('hex');

            assert.throws(() => contract.freeze('TST'), 'You arent an owner');
        });

        it('should freeze', async () => {
            global.block.hash = 'hashFreeze';

            contract.freeze('TST');

            assert.isOk(contract.isFrozen('TST'));

            const {arrTxHashChanges} = contract.tokenData('TST');
            assert.strictEqual(arrTxHashChanges[1], global.block.hash);
        });

        it('should NOT transfer after freeze', async () => {
            const strAddressReceiver = generateAddress().toString('hex');
            contract.approve('TST', strAddressReceiver, 100);

            contract.freeze('TST');

            assert.throws(
                () => contract.transfer('TST', strAddressReceiver, 1),
                'Token is frozen. No transfers allowed'
            );

            const strOwner = callerAddress;
            callerAddress = strAddressReceiver;
            assert.throws(
                () => contract.transferFrom('TST', strOwner, strAddressReceiver, 1),
                'Token is frozen. No transfers allowed'
            );
        });
    });

    describe.skip('decimals', async () => {
        const nTotalSupply = 1e5;
        let nDecimals = 0;
        beforeEach(async () => {
            global.value = 130000;
            global.callerAddress = generateAddress().toString('hex');

            const objTokedParams = {
                strSymbol: 'tst',
                nTotalSupply,
                strIssuerName: 'Me',
                strGoals: 'Test purposes',
                decimals: nDecimals++
            };

            contract.createToken(objTokedParams);
        });

        it('should get decimals (zero)', async () => {
            assert.strictEqual(contract.decimals('tst'), 0);
        });

        it('should get decimals (non zero)', async () => {
            assert.strictEqual(contract.decimals('tst'), 1);
        });
    });
});
