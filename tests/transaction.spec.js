const {describe, it} = require('mocha');
const {assert} = require('chai');
const debug = require('debug')('transaction:');

let keyPair;
let privateKey;
let publicKey;

factory = require('./testFactory');

describe('Transaction tests', () => {
    before(async function() {
        await factory.asyncLoad();
        keyPair = factory.Crypto.createKeyPair();
        privateKey = keyPair.getPrivate();
        publicKey = keyPair.getPublic();
    });

    it('should create empty transaction', async () => {
        const wrapper = () => new factory.Transaction();
        assert.doesNotThrow(wrapper);
    });

    it('should FAIL due oversized transaction', async () => {
        const wrapper = () => new factory.Transaction(Buffer.allocUnsafe(factory.Constants.MAX_BLOCK_SIZE + 1));
        assert.throws(wrapper);
    });

    it('should create transaction from Object', async () => {
        const wrapper = () => new factory.Transaction({
            payload: {
                ins: [{txHash: Buffer.from([1, 2, 3]), nTxOutput: 1}],
                outs: []
            },
            claimProofs: [Buffer.from([1, 2, 3])]
        });
        assert.doesNotThrow(wrapper);
    });

    it('should add input', async () => {
        const tx = new factory.Transaction();
        tx.addInput(Buffer.allocUnsafe(32), 1);
        assert.isOk(tx._data.payload.ins);
        assert.equal(tx._data.payload.ins.length, 1);
    });

    it('should add output (receiver)', async () => {
        const tx = new factory.Transaction();
        tx.addReceiver(100, Buffer.allocUnsafe(20));
        assert.isOk(tx._data.payload.outs);
        assert.equal(tx._data.payload.outs.length, 1);
    });

    it('should sign it', async () => {
        const tx = new factory.Transaction();
        tx.addInput(Buffer.allocUnsafe(32), 1);
        tx.addReceiver(100, Buffer.allocUnsafe(20));
        tx.sign(0, keyPair.privateKey);
        assert.isOk(Array.isArray(tx._data.claimProofs));
        assert.equal(tx._data.claimProofs.length, 1);
        assert.isOk(Buffer.isBuffer(tx._data.claimProofs[0]));

        assert.isOk(factory.Crypto.verify(tx.hash(), tx._data.claimProofs[0], keyPair.publicKey));
    });

    it('should FAIL to sign (missed PK) ', async () => {
        const tx = new factory.Transaction();
        tx.addInput(Buffer.allocUnsafe(32), 1);
        tx.addReceiver(100, Buffer.allocUnsafe(20));
        const wrapper = () => tx.sign(0);
        assert.throws(wrapper);
    });

    it('should FAIL to sign (wrong index) ', async () => {
        const tx = new factory.Transaction();
        tx.addInput(Buffer.allocUnsafe(32), 1);
        tx.addReceiver(100, Buffer.allocUnsafe(20));
        const wrapper = () => tx.sign(2, keyPair.privateKey);
        assert.throws(wrapper);
    });

    it('should FAIL to modify after signing it', async () => {
        const tx = new factory.Transaction();
        tx.addInput(Buffer.allocUnsafe(32), 1);
        tx.sign(0, keyPair.privateKey);
        const wrapper = () => tx.addInput(Buffer.allocUnsafe(32), 1);
        assert.throws(wrapper);
    });

    it('should encode/decode', async () => {
        const tx = new factory.Transaction();
        tx.addInput(Buffer.allocUnsafe(32), 15);
        tx.addReceiver(1117, Buffer.allocUnsafe(20));
        tx.sign(0, keyPair.privateKey);

        const buffEncoded = tx.encode();

        const recoveredTx = new factory.Transaction(buffEncoded);
        assert.isOk(recoveredTx.equals(tx));
    });

    it('should change hash upon modification', async () => {
        const tx = new factory.Transaction();
        tx.addInput(Buffer.allocUnsafe(32), 15);
        tx.addReceiver(1117, Buffer.allocUnsafe(20));
        const hash = tx.hash();

        tx._data.payload.ins[0].nTxOutput = 1;
        assert.notEqual(hash, tx.hash());
    });

    it('should fail signature check upon modification', async () => {
        const tx = new factory.Transaction();
        tx.addInput(Buffer.allocUnsafe(32), 15);
        tx.addReceiver(1117, Buffer.allocUnsafe(20));
        tx.sign(0, keyPair.privateKey);

        tx._data.payload.ins[0].nTxOutput = 1;

        assert.isNotOk(factory.Crypto.verify(tx.hash(), tx._data.claimProofs[0], keyPair.publicKey));
    });

    it('should fail to verify: no claimProof for input0', async () => {
        const tx = new factory.Transaction();
        tx.addInput(Buffer.allocUnsafe(32), 15);

        assert.isNotOk(tx.verify());
    });

    it('should fail to verify: zero tx', async () => {
        const tx = new factory.Transaction();
        tx.addInput(Buffer.alloc(32), 15);

        assert.isNotOk(tx.verify());
    });

    it('should fail to verify: negative tx index', async () => {
        const tx = new factory.Transaction();
        tx.addInput(Buffer.allocUnsafe(32), -1);

        assert.isNotOk(tx.verify());
    });

    it('should fail to verify: zero amount', async () => {
        const tx = new factory.Transaction();
        tx.addReceiver(0, Buffer.allocUnsafe(20));

        assert.isNotOk(tx.verify());
    });

    it('should verify', async () => {
        const tx = new factory.Transaction();
        tx.addInput(Buffer.allocUnsafe(32), 0);
        tx.addReceiver(1, Buffer.allocUnsafe(20));
        tx.sign(0, keyPair.privateKey);

        assert.isOk(tx.verify());
    });
});
