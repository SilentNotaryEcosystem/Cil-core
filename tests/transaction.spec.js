const { describe, it } = require('mocha');
const { assert } = require('chai');
const debug = require('debug')('transaction:');

const nonce = 20;
const gasLimit = 102;
const gasPrice = 21;
const to = '43543543525454';
const value = 1200;
const extField = 'extField';
// const transactionHash = 'f8611466158e34333534333534333532353435348204b0886578744669656c641ba00116bb32cad975d8464eaaaca0a5c78f7837fe7dbfffbaabba2a94a718d4df89a00535aef064ca55fd4eb40d031c88be2fb0c71959aa337ee0b8c1c96b034852be';

let keyPair;
let privateKey;
let publicKey;

factory = require('./testFactory');

describe('Transaction tests', () => {
    before(async function () {
        await factory.asyncLoad();
        keyPair = factory.Crypto.createKeyPair();
        privateKey = keyPair.getPrivate();
        publicKey = keyPair.getPublic();
    });

    it('shoud create transaction', async () => {
        const tr = new factory.Transaction({ payload: { nonce, gasLimit, gasPrice, to, value, extField } });
        console.log("Transaction: ", tr);
        assert.exists(tr);
        assert.isOk(tr);
    });
    it('shoud exist transactions signature', async () => {
        const tr = new factory.Transaction({ payload: { nonce, gasLimit, gasPrice, to, value, extField } });
        tr.sign(privateKey);
        console.log("Transaction signature: ", tr.signature);
        assert.exists(tr.signature);
        assert.isOk(tr.signature);
    });
    it('should create transactions hash', async () => {
        const tr = new factory.Transaction({ payload: { nonce, gasLimit, gasPrice, to, value, extField } });
        tr.sign(privateKey);
        const transactionHash = tr.serialize().toString("hex");
        console.log("Transaction hash: ", transactionHash);
        assert.isOk(tr);
        assert.isOk(transactionHash);
    });
    it('should exist recovered public key from signature', async () => {
        const tr = new factory.Transaction({ payload: { nonce, gasLimit, gasPrice, to, value, extField } });
        tr.sign(privateKey);
        console.log("Public key: ", tr.publicKey.encode('hex', true));
        assert.isOk(tr);
        assert.isOk(tr.publicKey);
    });
    it('should recovered public key equal generated public key', async () => {
        const tr = new factory.Transaction({ payload: { nonce, gasLimit, gasPrice, to, value } });
        const tr2 = new factory.Transaction({ payload: { nonce, gasLimit, gasPrice, to, value, extField } });
        
        tr.sign(privateKey);
        tr2.sign(privateKey);

        console.log("Generated public key: ", publicKey);
        console.log("Public key 1:         ", tr.publicKey.encode('hex', true));
        console.log("Public key 2:         ", tr2.publicKey.encode('hex', true));

        assert.isOk(tr);
        assert.isOk(tr.publicKey);
        assert.equal(tr.publicKey.encode('hex', true), publicKey);
        assert.equal(tr2.publicKey.encode('hex', true), publicKey);
    });
});
