'use strict';

const {describe, it} = require('mocha');
const chai = require('chai');
const {assert} = chai;
const sinon = require('sinon').createSandbox();

const factory = require('../testFactory');
const {pseudoRandomBuffer, generateAddress} = require('../testUtil');

chai.use(require('chai-as-promised'));

describe('Stored wallets', async () => {
    before(async function () {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function () {
        this.timeout(15000);
    });

    describe('account send/call', async () => {
        let sw;
        beforeEach(async () => {
            sinon.stub(factory.Crypto, 'decrypt').callsFake(() => 'fake');
            sw = new factory.StoredWallet({storage: new factory.Storage()});

            sw.getAccountAddresses = sinon.fake.resolves([
                generateAddress().toString('hex'),
                generateAddress().toString('hex'),
                generateAddress().toString('hex')
            ]);

            sw._ensureAccount = sinon.fake();
        });

        afterEach(async () => {
            sinon.restore();
        });

        it('should decode 2 keys (_ensurePk)', async () => {
            const map = new Map([
                [1, 'fakeKeystore'],
                [2, 'fakeKeystore2']
            ]);
            const mapResult = sw._ensurePk('fakePass', [1, 1, 2, 2, 2], map);
            assert.equal(mapResult.size, 2);
        });

        describe('_gatherInputsForAmount', async () => {
            it('should get only one (enough)', async () => {
                const arrObjUnspent = [
                    {hash: pseudoRandomBuffer().toString('hex'), nOut: 0, amount: 1e6},
                    {hash: pseudoRandomBuffer().toString('hex'), nOut: 0, amount: 1e2}
                ];

                const {arrCoins, gathered, bDone} = sw._gatherInputsForAmount(arrObjUnspent, 1e5);

                assert.equal(arrCoins.length, 1);
                assert.equal(gathered, 1e6);
                assert.equal(bDone, true);
            });

            it('should get two (one not enough)', async () => {
                const arrObjUnspent = [
                    {hash: pseudoRandomBuffer().toString('hex'), nOut: 0, amount: 1e6},
                    {hash: pseudoRandomBuffer().toString('hex'), nOut: 0, amount: 1e5}
                ];

                const {arrCoins, gathered, bDone} = sw._gatherInputsForAmount(arrObjUnspent, 1e6);

                assert.equal(arrCoins.length, 2);
                assert.equal(gathered, 1e6 + 1e5);
                assert.equal(bDone, true);
            });

            it('should get two (but not enough)', async () => {
                const arrObjUnspent = [
                    {hash: pseudoRandomBuffer().toString('hex'), nOut: 0, amount: 1e6},
                    {hash: pseudoRandomBuffer().toString('hex'), nOut: 0, amount: 1}
                ];

                const {arrCoins, gathered, bDone} = sw._gatherInputsForAmount(arrObjUnspent, 1e6);

                assert.equal(arrCoins.length, 2);
                assert.equal(gathered, 1e6 + 1);
                assert.equal(bDone, false);
            });

            it('should get two (but not enough)', async () => {
                const nFeeSize = 2 * sw._nFeePerInput;
                const arrObjUnspent = [
                    {hash: pseudoRandomBuffer().toString('hex'), nOut: 0, amount: 1e6},
                    {hash: pseudoRandomBuffer().toString('hex'), nOut: 0, amount: 1 + nFeeSize}
                ];

                const {arrCoins, gathered, bDone} = sw._gatherInputsForAmount(arrObjUnspent, 1e6);

                assert.equal(arrCoins.length, 2);
                assert.equal(gathered, 1e6 + nFeeSize + 1);
                assert.equal(bDone, true);
            });
        });

        describe('_formTxInputs', async () => {
            let tx;
            beforeEach(async () => {
                tx = new factory.Transaction();
                sw._storage.walletListUnspent = sinon.fake.resolves([]);
            });

            afterEach(async () => {
                sinon.restore();
            });

            it('should fill inputs for both addresses', async () => {
                const arrCoins = [
                    {hash: pseudoRandomBuffer().toString('hex'), nOut: 0, amount: 1e6},
                    {hash: pseudoRandomBuffer().toString('hex'), nOut: 0, amount: 1e2}
                ];
                let attempt = 0;
                sw._gatherInputsForAmount = () => {
                    return attempt++
                        ? {arrCoins: [arrCoins[0]], gathered: arrCoins[0].amount, bDone: true}
                        : {arrCoins: [arrCoins[1]], gathered: arrCoins[1].amount, bDone: false};
                };

                const arrAddresses = [generateAddress().toString('hex'), generateAddress().toString('hex')];
                const [nTotalGathered, arrAddressesOwners] = await sw._formTxInputs(tx, arrAddresses, 1e6);

                assert.equal(nTotalGathered, arrCoins[0].amount + arrCoins[1].amount);
                assert.deepEqual(arrAddressesOwners, arrAddresses);
                assert.equal(tx.inputs.length, 2);
            });

            it('should use only one address', async () => {
                const arrCoins = [
                    {hash: pseudoRandomBuffer().toString('hex'), nOut: 0, amount: 1e6},
                    {hash: pseudoRandomBuffer().toString('hex'), nOut: 0, amount: 1e2}
                ];
                let attempt = 0;
                sw._gatherInputsForAmount = () => {
                    return attempt++
                        ? {arrCoins: [arrCoins[1]], gathered: arrCoins[1].amount, bDone: false}
                        : {arrCoins: [arrCoins[0]], gathered: arrCoins[0].amount, bDone: true};
                };

                const arrAddresses = [generateAddress().toString('hex'), generateAddress().toString('hex')];
                const [nTotalGathered, arrAddressesOwners] = await sw._formTxInputs(tx, arrAddresses, 1e5);

                assert.equal(nTotalGathered, arrCoins[0].amount);
                assert.deepEqual(arrAddressesOwners, [arrAddresses[0]]);
                assert.equal(tx.inputs.length, 1);
            });
        });

        describe('_claimFundsAndSignTx', async () => {
            let tx;
            beforeEach(async () => {
                tx = new factory.Transaction();
            });

            afterEach(async () => {
                sinon.restore();
            });

            it('should claim inputs (no contract call)', async () => {
                tx.addInput(pseudoRandomBuffer().toString('hex'), 0);
                tx.addInput(pseudoRandomBuffer().toString('hex'), 0);

                sw._ensurePk = sinon.fake.returns(
                    new Map([
                        ['addr1', factory.Crypto.createKeyPair().privateKey],
                        ['addr2', factory.Crypto.createKeyPair().privateKey]
                    ])
                );

                await sw._claimFundsAndSignTx(tx, ['addr1', 'addr2']);

                assert.equal(tx.claimProofs.length, 2);
                assert.isNotOk(tx.getTxSignerAddress());
            });

            it('should claim inputs and sign for contract call', async () => {
                tx.addInput(pseudoRandomBuffer().toString('hex'), 0);
                tx.addInput(pseudoRandomBuffer().toString('hex'), 0);

                const kpAddr1 = factory.Crypto.createKeyPair();
                sw._ensurePk = sinon.fake.returns(
                    new Map([
                        ['addr1', kpAddr1.privateKey],
                        ['addr2', factory.Crypto.createKeyPair().privateKey]
                    ])
                );

                await sw._claimFundsAndSignTx(tx, ['addr1', 'addr2'], undefined, undefined, 'addr1');

                assert.equal(tx.claimProofs.length, 2);
                assert.strictEqual(tx.getTxSignerAddress(), kpAddr1.address);
            });

            it('should fail to claim (no PK for address)', async () => {
                tx.addInput(pseudoRandomBuffer().toString('hex'), 0);
                tx.addInput(pseudoRandomBuffer().toString('hex'), 0);

                sw._ensurePk = sinon.fake.returns(
                    new Map([
                        ['addr1', factory.Crypto.createKeyPair().privateKey],
                        ['addr2', factory.Crypto.createKeyPair().privateKey]
                    ])
                );

                return assert.isRejected(
                    sw._claimFundsAndSignTx(tx, ['addr1', 'addr2', 'addr3']),
                    'Private key for addr3 not found'
                );
            });
        });

        describe('sendToAddress', async () => {
            let arrFakeAddresses;
            beforeEach(async () => {
                arrFakeAddresses = [
                    generateAddress().toString('hex'),
                    generateAddress().toString('hex'),
                    generateAddress().toString('hex')
                ];
                sw.getAccountAddresses = sinon.fake.resolves(arrFakeAddresses);
                sw._claimFundsAndSignTx = sinon.fake();
                sw._mapAccountPasswords.set('fakeAcc', 'fakePass');
            });

            afterEach(async () => {
                sinon.restore();
            });

            it('should fail send (not enough coins)', async () => {
                sw._formTxInputs = async tx => {
                    tx.addInput(pseudoRandomBuffer(), 0);
                    tx.addInput(pseudoRandomBuffer(), 0);
                    return [1e5, arrFakeAddresses.slice(0, 2)];
                };

                return assert.isRejected(
                    sw.sendToAddress({
                        strAccountName: 'fakeAcc',
                        strAddressTo: generateAddress().toString('hex'),
                        nAmount: 1e5,
                        strChangeAddress: generateAddress().toString('hex')
                    }),
                    'Not enough coins to send. Required (with fee): 101280. Have: 100000'
                );
            });

            it('should send', async () => {
                sw._formTxInputs = async tx => {
                    tx.addInput(pseudoRandomBuffer(), 0);
                    tx.addInput(pseudoRandomBuffer(), 0);
                    return [1e6, arrFakeAddresses.slice(0, 2)];
                };
                sw._claimFundsAndSignTx = sinon.fake();
                sw._storage.getKeystoresForAccount = sinon.fake();

                const tx = await sw.sendToAddress({
                    strAccountName: 'fakeAcc',
                    strAddressTo: generateAddress().toString('hex'),
                    nAmount: 1e5,
                    strChangeAddress: generateAddress().toString('hex')
                });

                assert.isOk(tx);
                assert.isOk(sw._claimFundsAndSignTx.calledOnce);
            });
        });

        describe('callContract', async () => {
            let arrFakeAddresses;
            beforeEach(async () => {
                arrFakeAddresses = [
                    generateAddress().toString('hex'),
                    generateAddress().toString('hex'),
                    generateAddress().toString('hex')
                ];
                sw.getAccountAddresses = sinon.fake.resolves(arrFakeAddresses);
                sw._claimFundsAndSignTx = sinon.fake();
                sw._mapAccountPasswords.set('fakeAcc', 'fakePass');
                sw._storage.getKeystoresForAccount = sinon.fake();
            });

            afterEach(async () => {
                sinon.restore();
            });

            it('should fail to call (not enough coins)', async () => {
                sw._formTxInputs = async tx => {
                    tx.addInput(pseudoRandomBuffer(), 0);
                    tx.addInput(pseudoRandomBuffer(), 0);
                    return [1e5, arrFakeAddresses.slice(0, 2)];
                };

                return assert.isRejected(
                    sw.callContract({
                        strAccountName: 'fakeAcc',
                        strAddressContract: generateAddress().toString('hex'),
                        strMethod: 'test',
                        strJsonArguments: '[1,2,3,4]',
                        nAmount: 1e5,
                        strChangeAddress: factory.Constants.ADDRESS_PREFIX + generateAddress().toString('hex'),
                        strSignerAddress: factory.Constants.ADDRESS_PREFIX + arrFakeAddresses[0]
                    }),
                    'Not enough coins to send. Required (with fee): 151538. Have: 100000'
                );
            });

            it('should call (without signing contract)', async () => {
                sw._formTxInputs = async tx => {
                    tx.addInput(pseudoRandomBuffer(), 0);
                    tx.addInput(pseudoRandomBuffer(), 0);
                    return [1e6, arrFakeAddresses.slice(0, 2)];
                };
                sw._claimFundsAndSignTx = sinon.fake();

                const tx = await sw.callContract({
                    strAccountName: 'fakeAcc',
                    strAddressContract: generateAddress().toString('hex'),
                    strMethod: 'test',
                    strJsonArguments: '[1,2,3,4]',
                    nAmount: 1e5,
                    strChangeAddress: generateAddress().toString('hex'),
                    strSignerAddress: arrFakeAddresses[0]
                });

                assert.isOk(tx);
                assert.isOk(sw._claimFundsAndSignTx.calledOnce);
            });

            it('should call (and signing contract)', async () => {
                sw._formTxInputs = async tx => {
                    tx.addInput(pseudoRandomBuffer(), 0);
                    tx.addInput(pseudoRandomBuffer(), 0);
                    return [1e6, arrFakeAddresses.slice(0, 2)];
                };
                sw._claimFundsAndSignTx = sinon.fake();

                const tx = await sw.callContract({
                    strAccountName: 'fakeAcc',
                    strAddressContract: generateAddress().toString('hex'),
                    strMethod: 'test',
                    strJsonArguments: '[1,2,3,4]',
                    nAmount: 1e5,
                    strChangeAddress: generateAddress().toString('hex'),
                    strSignerAddress: factory.Constants.ADDRESS_PREFIX + arrFakeAddresses[0]
                });

                assert.isOk(tx);
                assert.isOk(sw._claimFundsAndSignTx.calledOnce);
            });
        });
    });
});
