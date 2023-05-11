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
            assert.equal(contract._data[strTokenId].length, 7);
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
            const {strSymbol, strName, strDescription, strTokenUri, strIssuerName, strTxHashChanges} =
                contract._getTokenData(strTokenId);

            assert.isOk(strSymbol);
            assert.isOk(strName);
            assert.isOk(strDescription);
            assert.isOk(strTokenUri);
            assert.isOk(strIssuerName);
            assert.deepEqual(strTxHashChanges, 'hash');
        });
    });

    describe('balanceOf', async () => {
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

    describe('approve', async () => {
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

        it('should throw (not the owner)', async () => {
            const strAddr = generateAddress().toString('hex');

            global.callerAddress = generateAddress().toString('hex');

            assert.throws(() => contract.approve(strAddr, strTokenId), "You aren't an owner");
        });

        it('should approve', async () => {
            const strAddr = generateAddress().toString('hex');

            contract.approve(strAddr, strTokenId);
        });
    });

    describe('transferFrom', async () => {
        let objTokedParams;
        let strTokenId;
        let strAddrReceiver = generateAddress().toString('hex');

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

        it('should throw (not the owner)', async () => {
            const strAddrSender = generateAddress().toString('hex');

            assert.throws(
                () => contract.transferFrom(strAddrSender, strAddrReceiver, strTokenId),
                "strFrom doesn't owns strTokenId"
            );
        });

        it('should throw (not authorized)', async () => {
            const strAddrSender = global.callerAddress;

            global.callerAddress = generateAddress().toString('hex');

            assert.throws(
                () => contract.transferFrom(strAddrSender, strAddrReceiver, strTokenId),
                'You are not an authorized person'
            );
        });

        it('should pass (transfer from owner)', async () => {
            const strAddrOwner = callerAddress;
            const bPrevBalance = contract.balanceOf(strAddrOwner);

            assert.equal(contract.ownerOf(strTokenId), strAddrOwner);
            assert.notEqual(contract.ownerOf(strTokenId), strAddrReceiver);

            contract.transferFrom(strAddrOwner, strAddrReceiver, strTokenId);

            assert.equal(contract.balanceOf(strAddrOwner), bPrevBalance - 1);
            assert.equal(contract.balanceOf(strAddrReceiver), 1);
            assert.notEqual(contract.ownerOf(strTokenId), strAddrOwner);
            assert.equal(contract.ownerOf(strTokenId), strAddrReceiver);
        });

        it('should pass (transfer via approved for all)', async () => {
            const strAddrOwner = callerAddress;
            const strProxyAddr = generateAddress().toString('hex');

            assert.equal(contract.ownerOf(strTokenId), strAddrOwner);
            assert.notEqual(contract.ownerOf(strTokenId), strAddrReceiver);
            assert.notEqual(contract.ownerOf(strTokenId), strProxyAddr);
            const bPrevBalance = contract.balanceOf(strAddrOwner);

            contract.setApprovalForAll(strProxyAddr, true);

            global.callerAddress = strProxyAddr;

            contract.transferFrom(strAddrOwner, strAddrReceiver, strTokenId);

            assert.equal(contract.balanceOf(strAddrOwner), bPrevBalance - 1);
            assert.equal(contract.balanceOf(strAddrReceiver), 1);
            assert.notEqual(contract.ownerOf(strTokenId), strAddrOwner);
            assert.equal(contract.ownerOf(strTokenId), strAddrReceiver);
        });

        // it.only('should throw (not enough)', async () => {
        //     const strAddrOwner = generateAddress().toString('hex');
        //     const strProxyAddr = generateAddress().toString('hex');

        //     callerAddress = strAddrOwner;

        //     contract.approve(strProxyAddr, strTokenId);
        //     const errMsg = `${callerAddress} has only ${objTokedParams.nTotalSupply}`;

        //     callerAddress = strProxyAddr;

        //     assert.throws(() => contract.transferFrom(strAddrOwner, strAddrReceiver, strTokenId), 'errMsg');
        // });

        it('should pass', async () => {
            const strAddrOwner = callerAddress;
            const strProxyAddr = generateAddress().toString('hex');
            contract.approve(strProxyAddr, strTokenId);
            const bPrevBalance = contract.balanceOf(strAddrOwner);

            assert.equal(contract.ownerOf(strTokenId), strAddrOwner);
            assert.notEqual(contract.ownerOf(strTokenId), strProxyAddr);

            callerAddress = strProxyAddr;

            contract.transferFrom(strAddrOwner, strAddrReceiver, strTokenId);

            assert.equal(contract.balanceOf(strAddrOwner), bPrevBalance - 1);
            assert.equal(contract.balanceOf(strAddrReceiver), 1);
            assert.notEqual(contract.ownerOf(strTokenId), strAddrOwner);
            assert.equal(contract.ownerOf(strTokenId), strAddrReceiver);

            // assert.equal(contract.allowance('TST', strAddrOwner, strProxyAddr), 0);

            // assert.equal(contract.balanceOf('TST', strAddrOwner), bPrevBalance - nAmountToSend);
            // assert.equal(contract.balanceOf('TST', strAddrReceiver), nAmountToSend);
            // assert.equal(contract.allowance('TST', strAddrOwner, strProxyAddr), 0);
        });
    });

    describe('direct call or private functions', async () => {
        beforeEach(async () => {
            global.bIndirectCall = false;
        });

        it('should throw for _transfer', async () => {
            assert.throws(() => contract._transfer(), "You aren't supposed to be here");
        });
    });
});
