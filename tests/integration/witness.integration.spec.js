const {describe, it} = require('mocha');
const {assert} = require('chai');
const os = require('os');
const debugLib = require('debug');
const util = require('util');

factory = require('../testFactory');

const debugWitness = debugLib('witness:app');

const maxConnections = os.platform() === 'win32' ? 4 : 10;

describe('Witness integration tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should ACT same as regular node (get peers from seedNode)', async function() {
        this.timeout(20000);

        const kpWallet = factory.Crypto.createKeyPair();
        const kpWitness1 = factory.Crypto.createKeyPair();
        const kpWitness2 = factory.Crypto.createKeyPair();

        const groupName = 'test';
        const arrTestDefinition = [
            [groupName, [kpWallet.getPublic(), kpWitness1.getPublic(), kpWitness2.getPublic()]],
            ['anotherGroup', ['pubkey3', 'pubkey4']]
        ];

        const seedAddress = factory.Transport.strToAddress('w seed node');
        const seedNode = new factory.Node({listenAddr: seedAddress, delay: 0});

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

        // start 2 witnesses
        const witnessWallet1 = new factory.Wallet(kpWitness1.getPrivate());
        const witnessNode1 = new factory.Witness({
            wallet: witnessWallet1, arrTestDefinition,
            listenAddr: factory.Transport.strToAddress('witness 1'), delay: 10,
            arrSeedAddresses: [seedAddress]
        });

//        const witnessWallet2=new factory.Wallet(kpWitness2.getPrivate());
//        const witnessNode2=new factory.Witness({
//            wallet: witnessWallet2, arrTestDefinition,
//            listenAddr: factory.Transport.strToAddress('witness 2'), delay: 0,
//            arrSeedAddresses: [seedAddress]
//        });
//
//        await Promise.all([witnessNode1.bootstrap(), witnessNode2.bootstrap()]);
//        await Promise.all([witnessNode1.start(), witnessNode2.start()]);

        await witnessNode1.bootstrap();
        await witnessNode1.start();

        // start our witness
        const wallet = new factory.Wallet(kpWallet.getPrivate());
        const witnessNode = new factory.Witness(
            {
                wallet, arrTestDefinition,
                listenAddr: factory.Transport.strToAddress('Test witness'),
                delay: 10, queryTimeout: 5000, arrSeedAddresses: [seedAddress]
            });
        await witnessNode.bootstrap();
        await witnessNode.start();

        const peers = witnessNode._peerManager.filterPeers();
        assert.isOk(peers && peers.length);

        // 2 from constructed object + seed + witness (self is banned, so it's not counted)
        assert.equal(peers.length, 4);
        peers.forEach(peerInfo => {
            assert.isOk(peerInfo && peerInfo.capabilities && peerInfo.address && peerInfo.port);
        });
    });

//    it(`should ACT same as regular node (create ${maxConnections} nodes and get all of them connected and advertised to seed)`,
//        async function() {
//            this.timeout(60000);
//            const seedAddress = factory.Transport.generateAddress();
//            const seedNode = new factory.Node({listenAddr: seedAddress, delay: 0});
//
//            const arrNodes = [];
//            const arrPromises = [];
//            for (let i = 0; i < maxConnections; i++) {
//                const wallet = new factory.Wallet(`0x${i}`);
//                const witnessNode = new factory.Witness(
//                    {wallet, arrSeedAddresses: [seedAddress], listenPort: 8000 + i});
//                arrPromises.push(witnessNode.bootstrap());
//                arrNodes.push(witnessNode);
//            }
//
//            await Promise.all(arrPromises);
//            for (let witnessNode of arrNodes) {
//                const peers = witnessNode._peerManager.filterPeers();
//                assert.isOk(peers && peers.length);
//            }
//
//            const seedPeers = seedNode._peerManager.filterPeers();
//            assert.isAtLeast(seedPeers.length, maxConnections);
//            seedPeers.forEach(peerInfo => {
//                assert.isOk(peerInfo && peerInfo.capabilities && peerInfo.address && peerInfo.port);
//
//                // we define custom ports 8000+i
//                assert.isOk(peerInfo.port >= 8000 && peerInfo.port <= 8000 + maxConnections);
//            });
//        }
//    );

});
