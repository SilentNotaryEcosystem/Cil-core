const {describe, it} = require('mocha');
const {assert} = require('chai');
const uuid = require('node-uuid');
const os = require('os');
const debugLib = require('debug');
const util = require('util');

factory = require('../testFactory');

const debugNode = debugLib('node:app');

const seedAddress = uuid.v4().substr(0, 16);
let seedNode;

const maxConnections = os.platform() === 'win32' ? 4 : 10;

describe('Node integration tests', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
        seedNode = new factory.Node({listenAddr: seedAddress});
    });

    after(async function() {
        this.timeout(15000);
    });

    it(`should create ${maxConnections} nodes and get all of them connected and advertised to seed`, async function() {
        this.timeout(60000);
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
        assert.equal(seedPeers.length, maxConnections);
        seedPeers.forEach(peerInfo => {
            assert.isOk(peerInfo && peerInfo.capabilities && peerInfo.address && peerInfo.port);

            // we define custom ports 8000+i
            assert.isOk(peerInfo.port >= 8000 && peerInfo.port <= 8000 + maxConnections);
        });
    });
});
