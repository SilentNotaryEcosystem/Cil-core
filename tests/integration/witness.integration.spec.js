const {describe, it} = require('mocha');
const {assert} = require('chai');
const os = require('os');
const debugLib = require('debug');

const factory = require('../testFactory');
const {sleep} = require('../../utils');

const debugWitness = debugLib('witness:app');

//const maxConnections = os.platform() === 'win32' ? 4 : 10;
const maxConnections = 1;

// set to undefined to use random delays
//const delay = undefined;
const delay = 10;

describe('Witness integration tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should ACT same as regular node (get peers from seedNode)', async function() {
        this.timeout(maxConnections * 60000);

        const groupName = 'test';
        const arrTestDefinition = [
            ['anotherGroup', ['pubkey3', 'pubkey4']]
        ];

        const seedAddress = factory.Transport.strToAddress('w seed node');
        const seedNode = new factory.Node({listenAddr: seedAddress, delay});

        // Peers already known by seedNode
        const peerInfo1 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null}
            ],
            address: factory.Transport.strToAddress('known peer 1')
        });
        const peerInfo2 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.WITNESS, data: Buffer.from('2222')}
            ],
            address: factory.Transport.strToAddress('known peer 2')
        });
        [peerInfo1, peerInfo2].forEach(peerInfo => seedNode._peerManager.addPeer(peerInfo));

        // create wallets
        const kpWallet = factory.Crypto.createKeyPair();
        const arrWallets = [];
        for (let i = 0; i < maxConnections; i++) {
            arrWallets.push(factory.Crypto.createKeyPair());
        }

        // update group definition
        arrTestDefinition.push(
            [groupName, [kpWallet.getPublic(), ...arrWallets.map(keyPair => keyPair.getPublic())]]);

        // create 'maxConnections' witnesses
        const arrWitnesses = [];
        for (let i = 0; i < maxConnections; i++) {
            const witnessWallet = new factory.Wallet(arrWallets[i].getPrivate());
            arrWitnesses.push(new factory.Witness({
                wallet: witnessWallet, arrTestDefinition,
                listenAddr: factory.Transport.strToAddress(`witness ${i + 1}`), delay,
                arrSeedAddresses: [seedAddress]
            }));
        }

        await Promise.all(arrWitnesses.map(witness => witness.bootstrap()));
        await Promise.all(arrWitnesses.map(witness => witness.start()));

        // start our witness
        const wallet = new factory.Wallet(kpWallet.getPrivate());
        const testWitness = new factory.Witness(
            {
                wallet, arrTestDefinition,
                listenAddr: factory.Transport.strToAddress('Test witness'), delay,
                queryTimeout: 5000, arrSeedAddresses: [seedAddress]
            });
        await testWitness.bootstrap();
        await testWitness.start();

        const peers = testWitness._peerManager.filterPeers();
        assert.isOk(peers && peers.length);

        // 2 from constructed object + seed + maxConnections witness (self is banned, so it's not counted)
        assert.equal(peers.length, 2 + 1 + maxConnections);
        peers.forEach(peerInfo => {
            assert.isOk(peerInfo && peerInfo.capabilities && peerInfo.address && peerInfo.port);
        });

        // maxConnections + 1 seed
        assert.equal(testWitness._peerManager.connectedPeers().length, maxConnections + 1);

        // maxConnections witnesses
        assert.equal(testWitness._peerManager.connectedPeers(groupName).length, maxConnections);

        for (let witness of arrWitnesses) {

            // connected at least to test witness
            assert.isAtLeast(witness._peerManager.connectedPeers(groupName).length, 1);
        }

        await sleep(factory.Constants.consensusTimeouts.INIT * 3);
    });

//    it('should DISCONNECT from FAKE Witness', async () => {

//        const kpTest = factory.Crypto.createKeyPair();
//        const kpGood = factory.Crypto.createKeyPair();
//        const kpWalletFake = factory.Crypto.createKeyPair();
//
//        const groupName = 'test';
//        const arrTestDefinition = [
//            [groupName, [kpTest.getPublic(), kpGood.getPublic()]],
//            ['anotherGroup', ['pubkey3', 'pubkey4']]
//        ];
//
//        // create fake
//        const fakeAddress=factory.Transport.strToAddress(`fake witness`);
//        const fakeWitnessWallet = new factory.Wallet(kpWalletFake.getPrivate());
//        const fakeWitness=new factory.Witness({
//            wallet: fakeWitnessWallet, arrTestDefinition,
//            listenAddr: fakeAddress, delay: 10,
//            arrSeedAddresses: []
//        });
//
//        // start our witness
//        const wallet = new factory.Wallet(kpTest.getPrivate());
//        const testWitness = new factory.Witness(
//            {
//                wallet, arrTestDefinition,
//                listenAddr: factory.Transport.strToAddress('Test witness 2'),
//                delay: 10, queryTimeout: 5000, arrSeedAddresses: [fakeAddress]
//            });
//        await testWitness.bootstrap();
//        await testWitness.start();

//    });
});
