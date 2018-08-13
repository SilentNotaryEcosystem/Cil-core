const {describe, it} = require('mocha');
const {assert} = require('chai');
const debug = require('debug')('wallet:');

factory = require('./testFactory');

describe('Wallet tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should NOT create wallet', async () => {
        try {
            new factory.Wallet();
            assert.isOk(false, 'Unexpected success');
        } catch (err) {
            debug(err);
        }
    });

    it('should create wallet', function() {
        const wallet = new factory.Wallet('b7760a01705490e5e153a6ef7732369a72dbf9aaafb5c482cdfd960546909ec1');
        assert.isOk(wallet.publicKey);
    });

});
