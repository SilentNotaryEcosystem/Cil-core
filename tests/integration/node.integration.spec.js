const {describe, it} = require('mocha');
const {assert} = require('chai');
const uuid = require('node-uuid');
const os = require('os');
const debugLib = require('debug');
const util = require('util');

factory = require('../testFactory');

const debugNode = debugLib('node:app');

const maxConnections = os.platform() === 'win32' ? 4 : 10;

describe('Node integration tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should disconnect from self', async () => {
        const addr = factory.Transport.strToAddress('Loop node');
        const newNode = new factory.Node({
            listenAddr: addr,
            delay: 0, queryTimeout: 5000,
            arrSeedAddresses: [addr]
        });
        await newNode.bootstrap();
    });

    it('should get peers from seedNode', async function() {
        this.timeout(20000);

        const seedAddress = factory.Transport.strToAddress('Seed node');
        const seedNode = new factory.Node({listenAddr: seedAddress, delay: 0});
        const peerInfo1 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null},
                {service: factory.Constants.WITNESS, data: Buffer.from('asdasdasd')}
            ],
            address: factory.Transport.strToAddress('Known node 1')
        });
        const peerInfo2 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.NODE, data: null}
            ],
            address: factory.Transport.strToAddress('Known node 2')
        });
        const peerInfo3 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.WITNESS, data: Buffer.from('1111')}
            ],
            address: factory.Transport.strToAddress('Known node 3')
        });
        const peerInfo4 = new factory.Messages.PeerInfo({
            capabilities: [
                {service: factory.Constants.WITNESS, data: Buffer.from('2222')}
            ],
            address: factory.Transport.strToAddress('Known node 4')
        });
        [peerInfo1, peerInfo2, peerInfo3, peerInfo4].forEach(peerInfo => seedNode._peerManager.addPeer(peerInfo));

        const testNode = new factory.Node({
            listenAddr: factory.Transport.strToAddress('Test node'),
            delay: 0, queryTimeout: 5000, arrSeedAddresses: [seedAddress]
        });
        await testNode.bootstrap();

        const peers = testNode._peerManager.filterPeers();
        assert.isOk(peers && peers.length);

        // 4 from constructed object + seed + self
        assert.equal(peers.length, 6);
        peers.forEach(peerInfo => {
            assert.isOk(peerInfo && peerInfo.capabilities && peerInfo.address && peerInfo.port);
        });
    });

    it(`should create ${maxConnections} nodes and get all of them connected and advertised to seed`, async function() {
        this.timeout(60000);
        const seedAddress = factory.Transport.generateAddress();
        const seedNode = new factory.Node({listenAddr: seedAddress, delay: 0});

        const arrNodes = [];
        const arrPromises = [];
        for (let i = 0; i < maxConnections; i++) {
            const node = new factory.Node({arrSeedAddresses: [seedAddress], listenPort: 8000 + i});
            arrPromises.push(node.bootstrap());
            arrNodes.push(node);
        }

        await Promise.all(arrPromises);
        for (let node of arrNodes) {
            const peers = node._peerManager.filterPeers();
            assert.isOk(peers && peers.length);
        }

        const seedPeers = seedNode._peerManager.filterPeers();
        assert.isAtLeast(seedPeers.length, maxConnections);
        seedPeers.forEach(peerInfo => {
            assert.isOk(peerInfo && peerInfo.capabilities && peerInfo.address && peerInfo.port);

            // we define custom ports 8000+i
            assert.isOk(peerInfo.port >= 8000 && peerInfo.port <= 8000 + maxConnections);
        });
    });

});
