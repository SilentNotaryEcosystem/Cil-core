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

        it('should throw (validate parameters)', async () => {
            assert.throws(
                () => contract.createToken({...objTokedParams, strSymbol: null}),
                'strSymbol should be a string'
            );
            assert.throws(() => contract.createToken({...objTokedParams, strName: null}), 'strName should be a string');
            assert.throws(
                () => contract.createToken({...objTokedParams, strDescription: null}),
                'strDescription should be a string'
            );
            assert.throws(
                () => contract.createToken({...objTokedParams, strTokenUri: null}),
                'strTokenUri should be a string'
            );
            assert.throws(
                () => contract.createToken({...objTokedParams, strIssuerName: null}),
                'strIssuerName should be a string'
            );
            assert.throws(
                () => contract.createToken({...objTokedParams, strSymbol: ''}),
                'strSymbol should not be empty'
            );
            assert.throws(
                () => contract.createToken({...objTokedParams, strSymbol: 'ASCDFTE'}),
                'Symbol should be at most 6 chars'
            );
            assert.throws(
                () => contract.createToken({...objTokedParams, strNewParam: 'Some text'}),
                'strNewParam is not required'
            );
            assert.throws(
                () => contract.createToken({}),
                `Key(s): '["strSymbol","strName","strDescription","strTokenUri","strIssuerName"]' are required`
            );
            assert.throws(
                () => contract.createToken({...objTokedParams, strTokenUri: 'ftp:/12/12.12'}),
                'strTokenUri should be an URI'
            );
            contract.createToken({...objTokedParams, strTokenUri: 'https://www.web.com/path#anchor'});
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

            assert.equal(contract.getApproved(strTokenId), strAddr);
        });
    });

    describe('approvalForAll', async () => {
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

        it('should approve', async () => {
            const strAddr = generateAddress().toString('hex');

            contract.setApprovalForAll(strAddr, true);

            assert.isTrue(contract.isApprovedForAll(global.callerAddress, strAddr));
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
                'Transfer from incorrect owner'
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

        it('should pass (transfer via approve)', async () => {
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

    describe('royalty', async () => {
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

        it('should test default royalty', async () => {
            assert.deepEqual(contract.royaltyInfo(strTokenId, 100), {receiver: null, royaltyAmount: 0});

            const strDefaultRoyaltyReceiver = generateAddress().toString('hex');

            contract._setDefaultRoyalty(strDefaultRoyaltyReceiver, 2000);

            assert.deepEqual(contract.royaltyInfo(strTokenId, 100), {
                receiver: strDefaultRoyaltyReceiver,
                royaltyAmount: 20
            });
        });

        it('should test token royalty', async () => {
            assert.deepEqual(contract.royaltyInfo(strTokenId, 100), {receiver: null, royaltyAmount: 0});

            const strRoyaltyReceiver = generateAddress().toString('hex');

            contract._setTokenRoyalty(strTokenId, strRoyaltyReceiver, 2500);

            assert.deepEqual(contract.royaltyInfo(strTokenId, 100), {
                receiver: strRoyaltyReceiver,
                royaltyAmount: 25
            });
        });

        it('should override default royalty', async () => {
            const strDefaultRoyaltyReceiver = generateAddress().toString('hex');
            const strRoyaltyReceiver = generateAddress().toString('hex');

            contract._setDefaultRoyalty(strDefaultRoyaltyReceiver, 2000);

            contract._setTokenRoyalty(strTokenId, strRoyaltyReceiver, 2500);

            assert.deepEqual(contract.royaltyInfo(strTokenId, 100), {
                receiver: strRoyaltyReceiver,
                royaltyAmount: 25
            });
        });
    });
});
