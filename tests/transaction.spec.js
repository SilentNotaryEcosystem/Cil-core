const { describe, it } = require('mocha');
const { assert } = require('chai');
const debug = require('debug')('transaction:');
const crypto = require('crypto');

const txPayload = {
    nonce: 20,
    gasLimit: 102,
    gasPrice: 21,
    to: '43543543525454',
    value: 1200,
    extField: 'extFieldextFieldextField'
};

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

    // it('should restore the correct public key from the signature', async () => {
    //     for (let i = 1; i <= 1000; i++) {
    //         const countBytes = Math.round(Math.random() * (8192 - 1) + 1);
    //         const buff = crypto.randomBytes(countBytes);
    //         const buffHash = factory.Crypto.getHash(buff);
    //         const { signature, recoveryParam } = factory.Crypto.sign(buffHash, privateKey, undefined, undefined, true);

    //         const recoveredPublicKey = factory.Crypto.recoverPubKey(buffHash, signature, recoveryParam);
    //         assert.equal(recoveredPublicKey.encode('hex', true), publicKey);
    //     }
    // });

    // it('should be a valid signature', async () => {
    //     for (let i = 1; i <= 1000; i++) {
    //         const countBytes = Math.round(Math.random() * (8192 - 1) + 1);
    //         const buff = crypto.randomBytes(countBytes);
    //         const buffHash = factory.Crypto.getHash(buff);
    //         const { signature, recoveryParam } = factory.Crypto.sign(buffHash, privateKey, undefined, undefined, true);

    //         const recoveredPublicKey = factory.Crypto.recoverPubKey(buffHash, signature, recoveryParam);

    //         assert.equal(factory.Crypto.verify(buffHash, signature, recoveredPublicKey), true, 'Signature is not valid');
    //     }
    // });

    it('should create transaction', async () => {
        const tr = new factory.Transaction({ payload: txPayload });
        assert.exists(tr);
        assert.isOk(tr);
    });
    it('should exist transactions signature', async () => {
        const tr = new factory.Transaction({ payload: txPayload });
        tr.sign(privateKey);
        assert.exists(tr.signature);
        assert.isOk(tr.signature);
    });
    it('should create transactions hash', async () => {
        const tr = new factory.Transaction({ payload: txPayload });
        tr.sign(privateKey);
        const transactionHash = tr.serialize();
        assert.isOk(tr);
        assert.isOk(transactionHash);
    });
    it('should exist recovered public key from signature', async () => {
        const tr = new factory.Transaction({ payload: txPayload });
        tr.sign(privateKey);
        assert.isOk(tr);
        assert.isOk(tr.publicKey);
    });
    it('should be equality recovered public key generated public key', async () => {
        const tr = new factory.Transaction({ payload: txPayload });
        tr.sign(privateKey);
        assert.isOk(tr);
        assert.isOk(tr.publicKey);
        assert.equal(tr.publicKey.encode('hex', true), publicKey);
    });
    it('should deserialize transaction', async () => {
        const tr = new factory.Transaction({ payload: txPayload });
        tr.sign(privateKey);
        const transactionHash = tr.serialize();
        const deserializedTr = new factory.Transaction(transactionHash);
        assert.isOk(deserializedTr);
    });
    it('should be valid transactions signature', async () => {
        const tr = new factory.Transaction({ payload: txPayload });
        tr.sign(privateKey);
        const deserializedTr = new factory.Transaction(tr.serialize());
        assert.equal(deserializedTr.verifySignature(), true);
    });
    it('should be NOT valid transactions signature', async () => {
        const tr = new factory.Transaction({ payload: txPayload });
        tr.sign(privateKey);
        let deserializedTr = new factory.Transaction(tr.serialize());
        deserializedTr.payload.nonce = 22;
        assert.equal(deserializedTr.verifySignature(), false);
    });
});
