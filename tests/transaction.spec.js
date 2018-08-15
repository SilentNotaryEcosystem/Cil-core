const { describe, it } = require('mocha');
const { assert } = require('chai');
const debug = require('debug')('transaction:');
const Crypto = require('../crypto/crypto');
const Payload = require('../transaction/payload');
const Transaction = require('../transaction/transaction');

const nonce = 20;
const gasLimit = 102;
const gasPrice = 21;
const to = '43543543525454';
const value = 1200;
const extField = 'extField';
const transactionHash = 'f8611466158e34333534333534333532353435348204b0886578744669656c641ba00116bb32cad975d8464eaaaca0a5c78f7837fe7dbfffbaabba2a94a718d4df89a00535aef064ca55fd4eb40d031c88be2fb0c71959aa337ee0b8c1c96b034852be';

const keyPair = Crypto.createKeyPair();
const privateKey = keyPair.getPrivate();
const publicKey = keyPair.getPublic();

describe('Transaction tests', () => {
    it('Transaction create', async () => {
        let tr = new Transaction(new Payload(nonce, gasLimit, gasPrice, to, value, extField));
        console.log("Transaction: ", tr);
        assert.exists(tr);
        assert.isOk(tr);
    });
    it('Transaction serialize without signature', async () => {
        let tr = new Transaction(new Payload(nonce, gasLimit, gasPrice, to, value, extField));
        let hash = tr.serialize();
        console.log("Transaction hash: ", hash.toString("hex"));
        assert.exists(hash);
        assert.isOk(hash);
    });
    it('Sign transaction', async () => {
        let tr = new Transaction(new Payload(nonce, gasLimit, gasPrice, to, value, extField));
        tr.sign(privateKey);
        console.log("Transaction signature: ", tr.signature);
        assert.exists(tr.signature);
        assert.isOk(tr.signature);
    });
    it('Transaction serialize with signature', async () => {
        let tr = new Transaction(new Payload(nonce, gasLimit, gasPrice, to, value, extField));
        let hashWithoutSign = tr.serialize();
        console.log("Transaction hash without signature: ", hashWithoutSign.toString("hex"));
        tr.sign(privateKey);
        let hashWithSign = tr.serialize();
        console.log("Transaction hash with signature: ", hashWithSign.toString("hex"));
        assert.isOk(tr);
        assert.isOk(hashWithoutSign);
        assert.isOk(hashWithSign);
        assert.notEqual(hashWithoutSign, hashWithSign);
    });
    it('Transaction deserialize', async () => {
        let tr = Transaction.deserialize(transactionHash);
        console.log("Deserialized transaction: ", tr);
        assert.isOk(tr);
        assert.equal(tr.payload.nonce, nonce);
        assert.equal(tr.payload.gasLimit, gasLimit);
        assert.equal(tr.payload.gasPrice, gasPrice);
        assert.equal(tr.payload.to, to);
        assert.equal(tr.payload.value, value);
        assert.equal(tr.payload.extField, extField);
    });
    it('Check public key from signature', async () => {
        let tr = new Transaction(new Payload(nonce, gasLimit, gasPrice, to, value, extField));
        tr.sign(privateKey);
        let hashWithSign = tr.serialize();

        tr = Transaction.deserialize(hashWithSign);
        let key = tr.publicKey;
        assert.isOk(key);
        assert.equal(key, publicKey);
    });
    it('Check signature validate', async () => {
        try {
            let tr = new Transaction(new Payload(nonce, gasLimit, gasPrice, to, value, extField));
            tr.sign(privateKey);
            let hash = tr.serialize();
            let newTr = Transaction.deserialize(hash);
            let validateResult = newTr.validate();
            assert.equal(validateResult, true);
        } catch (err) {
            console.error(err);
        }
    });
});
