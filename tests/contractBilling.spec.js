'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const {generateAddress} = require('./testUtil');

let keyPair;
let privateKey;
let publicKey;

const factory = require('./testFactory');

describe('Tests of contract billing', () => {
    before(async () => {
        await factory.asyncLoad();
        keyPair = factory.Crypto.createKeyPair();
        privateKey = keyPair.getPrivate();
        publicKey = keyPair.getPublic();
    });

    describe('Check unsupported operations', () => {
        it('should not allow to create a contract with a dangerous operation and throw an exception: process.exit()', () => {
            const strCode = '{ process.exit(1); }';
            const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
            assert.throws(createContract);
        })

        it('should not allow to create a contract with a dangerous operation and throw an exception: Math.random();', () => {
            const strCode = '{ class A { testMethod() { return Math.random(); } } }';
            const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
            assert.throws(createContract);
        })

        it('should not allow to create a contract with a dangerous operation and throw an exception: eval();', () => {
            const strCode = '{ function test() { eval("process.exit(1);"); } }';
            const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
            assert.throws(createContract);
        })

        it('should not throw an exception', () => {
            const strCode = '{}';
            const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
            assert.isOk(createContract());
        })
    });
})
