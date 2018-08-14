const {describe, it} = require('mocha');
const {assert} = require('chai');
const debug = require('debug')('witness:');

factory = require('./testFactory');

let wallet;

describe('Witness tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();

        wallet = new factory.Wallet('b7760a01705490e5e153a6ef7732369a72dbf9aaafb5c482cdfd960546909ec1');
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should NOT create witness', async () => {
        try {
            new factory.Witness();
            assert.isOk(false, 'Unexpected success');
        } catch (err) {}
    });

    it('should create witness', function() {
        new factory.Witness({wallet});
    });

    it('should get my group from pubKey', async () => {
        const groupName = 'test';
        const arrTestDefinition = [
            [groupName, [wallet.publicKey, 'pubkey1', 'pubkey2']],
            ['anotherGroup', ['pubkey3', 'pubkey4']]
        ];
        const witness = new factory.Witness({wallet, arrTestDefinition});
        const result = await witness._getMyGroups();
        assert.isOk(Array.isArray(result));
        assert.equal(result.length, 1);
        assert.equal(result[0], groupName);
    });

    it('should get peers for my group', async () => {
        const groupName = 'test';
        const arrTestDefinition = [
            [groupName, [wallet.publicKey, Buffer.from('pubkey1'), Buffer.from('pubkey2')]],
            ['anotherGroup', [Buffer.from('pubkey3'), Buffer.from('pubkey4')]]
        ];
        const witness = new factory.Witness({wallet, arrTestDefinition});

        const peerInfo1 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null},
                {service: factory.Constants.WITNESS, data: Buffer.from('pubkey1')}
            ],
            address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x3}
        });
        const peerInfo2 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null}
            ],
            address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x4}
        });
        const peerInfo3 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.WITNESS, data: Buffer.from('1111')}
            ],
            address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x5}
        });
        const peerInfo4 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.WITNESS, data: Buffer.from('pubkey2')}
            ],
            address: {addr0: 0x2001, addr1: 0xdb8, addr2: 0x1234, addr3: 0x6}
        });
        [peerInfo1, peerInfo2, peerInfo3, peerInfo4].forEach(peerInfo => witness._peerManager.addPeer(peerInfo));

        const result = await witness._getGroupPeers(groupName);
        assert.isOk(Array.isArray(result));
        assert.equal(result.length, 2);
    });
});
