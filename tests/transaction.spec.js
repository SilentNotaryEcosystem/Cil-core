const { describe, it } = require('mocha');
const { assert } = require('chai');
const debug = require('debug')('transaction:');
const crypto = require('crypto');

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

    it('should restore the correct public key from the signature', async () => {
        for (let i = 1; i <= 1000; i++) {
            // const countBytes = Math.random() * (8192 - 1) + 1;
            // const buff = crypto.randomBytes(countBytes);
            const buff = crypto.randomBytes(i);
            // const signature = factory.Crypto.sign(buff, privateKey, "hex", { canonical: true }, false);
            const signature = factory.Crypto.sign(buff, privateKey, undefined, undefined, false);

            const recoveredPublicKey = factory.Crypto.recoverPubKey(buff, signature, signature.recoveryParam);
            console.log("countBytes: ", i);
            console.log("publicKey: ", publicKey);
            console.log("recoveredPublicKey: ", recoveredPublicKey.encode('hex', true));
            assert.equal(recoveredPublicKey.encode('hex', true), publicKey);
        }
    });

    it('should be a valid signature', async () => {
        for (let i = 1; i <= 1000; i++) {
            const countBytes = Math.random() * (8192 - 10) + 10;
            const buff = crypto.randomBytes(countBytes);
            const signature = factory.Crypto.sign(buff, privateKey, undefined, undefined, false);

            const recoveredPublicKey = factory.Crypto.recoverPubKey(buff, signature, signature.recoveryParam);
            
            const result = factory.Crypto.verify(buff, signature, recoveredPublicKey);

            assert.equal(result, true, 'Signature is not valid');
        }
    });

    // it('should create transaction', async () => {
    //     const tr = new factory.Transaction({ payload: { nonce, gasLimit, gasPrice, to, value, extField } });
    //     console.log("Transaction: ", tr);
    //     assert.exists(tr);
    //     assert.isOk(tr);
    // });
    // it('should exist transactions signature', async () => {
    //     const tr = new factory.Transaction({ payload: { nonce, gasLimit, gasPrice, to, value, extField } });
    //     tr.sign(privateKey);
    //     console.log("Transaction signature: ", tr.signature);
    //     assert.exists(tr.signature);
    //     assert.isOk(tr.signature);
    // });
    // it('should create transactions hash', async () => {
    //     const tr = new factory.Transaction({ payload: { nonce, gasLimit, gasPrice, to, value, extField } });
    //     tr.sign(privateKey);
    //     const transactionHash = tr.serialize().toString("hex");
    //     console.log("Transaction hash: ", transactionHash);
    //     assert.isOk(tr);
    //     assert.isOk(transactionHash);
    // });
    // it('should exist recovered public key from signature', async () => {
    //     const tr = new factory.Transaction({ payload: { nonce, gasLimit, gasPrice, to, value, extField } });
    //     tr.sign(privateKey);
    //     console.log("Public key: ", tr.publicKey.encode('hex', true));
    //     assert.isOk(tr);
    //     assert.isOk(tr.publicKey);
    // });
    // it('should recovered public key equal generated public key', async () => {
    //     const tr = new factory.Transaction({ payload: { nonce, gasLimit, gasPrice, to, value } });
    //     const tr2 = new factory.Transaction({ payload: { nonce, gasLimit, gasPrice, to, value, extField } });

    //     tr.sign(privateKey);
    //     tr2.sign(privateKey);

    //     console.log("Generated public key: ", publicKey);
    //     console.log("Public key 1:         ", tr.publicKey.encode('hex', true));
    //     console.log("Public key 2:         ", tr2.publicKey.encode('hex', true));

    //     assert.isOk(tr);
    //     assert.isOk(tr.publicKey);
    //     assert.equal(tr.publicKey.encode('hex', true), publicKey);
    //     assert.equal(tr2.publicKey.encode('hex', true), publicKey);
    // });
});
