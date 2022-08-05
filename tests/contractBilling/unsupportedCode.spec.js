'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const {generateAddress} = require('../testUtil');

let keyPair;
let privateKey;
let publicKey;

const factory = require('../testFactory');

describe('Contract billing: Check unsupported operations', () => {
    before(async () => {
        await factory.asyncLoad();
        keyPair = factory.Crypto.createKeyPair();
        privateKey = keyPair.getPrivate();
        publicKey = keyPair.getPublic();
    });

    const UnsupportedExceptionText = 'Found unsupported operation in the contract!';

    it('should not allow to create a contract with a dangerous operation and throw an exception: process.exit()', () => {
        const strCode = '{ process.exit(1); }';
        const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not allow to create a contract with a dangerous operation and throw an exception: Math.random();', () => {
        const strCode = '{ class A { testMethod() { return Math.random(); } } }';
        const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not allow to create a contract with a dangerous operation and throw an exception: eval();', () => {
        const strCode = '{ function test() { eval("process.exit(1);"); } }';
        const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not allow to create a contract with an arrow function', () => {
        const strCode = '{ const f = () => {}; }';
        const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
        assert.throws(createContract, UnsupportedExceptionText);
    });


    it('should not throw an exception for the contract without a dangerous operation', () => {
        const strCode = '{}';
        const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
        assert.doesNotThrow(createContract);
    });

    it('should not allow to create a contract with a string regex', () => {
        const strCode = '{ let a = /^TEST$/; }';
        const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not allow to create a contract with a string regex test', () => {
        const strCode = '{ /.*/gi.test("test"); }';
        const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not allow to create a contract with a string regex replace', () => {
        const strCode = '{ "ab".replaceAll(/b/, "c"); }';
        const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not allow to create a contract with an object regex', () => {
        const strCode = '{ let a = new RegExp("^TEST$") }';
        const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not allow to create a contract with an object regex test', () => {
        const strCode = '{ new RegExp(".*", "gi").test("test"); }';
        const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
        assert.throws(createContract, UnsupportedExceptionText);
    });

    it('should not allow to create a contract with an object regex replace', () => {
        const strCode = '{ "ab".replaceAll(new RegExp("b"), "c"); }';
        const createContract = () => factory.Transaction.createContract(strCode, generateAddress());
        assert.throws(createContract, UnsupportedExceptionText);
    });
});
