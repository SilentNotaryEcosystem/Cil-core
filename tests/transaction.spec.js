const { describe, it } = require('mocha');
const { assert } = require('chai');
const debug = require('debug')('transaction:');

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
    //         const buff = factory.Crypto.randomBytes(countBytes);
    //         const buffHash = factory.Crypto.createHash(buff);
    //         const { signature, recoveryParam } = factory.Crypto.sign(buffHash, privateKey, undefined, undefined, true);

    //         const recoveredPublicKey = factory.Crypto.recoverPubKey(buffHash, signature, recoveryParam);
    //         assert.equal(recoveredPublicKey.encode('hex', true), publicKey);
    //     }
    // });

    // it('should be a valid signature', async () => {
    //     for (let i = 1; i <= 1000; i++) {
    //         const countBytes = Math.round(Math.random() * (8192 - 1) + 1);
    //         const buff = factory.Crypto.randomBytes(countBytes);
    //         const buffHash = factory.Crypto.createHash(buff);
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
        const transactionHash = tr.encode();
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
        const transactionHash = tr.encode();
        const deserializedTr = new factory.Transaction(transactionHash);
        assert.isOk(deserializedTr);
    });
    it('should PASS verification', async () => {
        const tr = new factory.Transaction({ payload: txPayload });
        tr.sign(privateKey);
        const deserializedTr = new factory.Transaction(tr.encode());
        assert.equal(deserializedTr.verifySignature(), true);
    });
    it('should FAIL verification', async () => {
        const tr = new factory.Transaction({ payload: txPayload });
        tr.sign(privateKey);
        let deserializedTr = new factory.Transaction(tr.encode());
        deserializedTr.payload.nonce = 22;
        assert.equal(deserializedTr.verifySignature(), false);
    });


    it('temporary experiment', async () => {
        const buff1 = factory.Crypto.randomBytes(64);
        const buff2 = factory.Crypto.randomBytes(64);
        const buffHash1 = factory.Crypto.createHash(buff1);
        const buffHash2 = factory.Crypto.createHash(buff2);
        console.log('buffHash1:', buffHash1.toString('hex'));
        console.log('buffHash2:', buffHash2.toString('hex'));

        const sig1 = factory.Crypto.sign(buffHash1, privateKey, undefined, undefined, true);
        const sig2 = factory.Crypto.sign(buffHash2, privateKey, undefined, undefined, true);

        console.log('signature1:', sig1.signature.toString('hex'), 'recoveryParam1:', sig1.recoveryParam);
        console.log('signature2:', sig2.signature.toString('hex'), 'recoveryParam2:', sig2.recoveryParam);

        const recoveredKey1 = factory.Crypto.recoverPubKey(buffHash1, sig1.signature, sig1.recoveryParam);
        const recoveredKey2 = factory.Crypto.recoverPubKey(buffHash2, sig1.signature, sig1.recoveryParam);

        console.log('recoveredKey1:', recoveredKey1.encode('hex', true));
        console.log('recoveredKey2:', recoveredKey2.encode('hex', true));

        console.log('verifySignature1:', factory.Crypto.verify(buffHash1, sig1.signature, recoveredKey1));
        console.log('verifySignature2:', factory.Crypto.verify(buffHash2, sig1.signature, recoveredKey2));
    });
});
