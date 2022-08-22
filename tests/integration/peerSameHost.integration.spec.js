'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('../testFactoryIpV6');

let nodeSeed;
let node2;
let node3;

const sleep = delay => {
    return new Promise(resolve => {
        setTimeout(() => resolve(), delay);
    });
};

describe('Same host, different port peers', () => {
    before(async function () {
        this.timeout(15000);

        await factory.asyncLoad();

        nodeSeed = new factory.Node({
            listenAddr: '127.0.0.1',
            trustAnnounce: true,
            seed: true
        });

        node2 = new factory.Node({
            listenAddr: '127.0.0.1',
            listenPort: 22222,
            trustAnnounce: true,
            arrSeedAddresses: ['127.0.0.1']
        });

        node3 = new factory.Node({
            listenAddr: '127.0.0.1',
            listenPort: 33333,
            trustAnnounce: true,
            arrSeedAddresses: ['127.0.0.1']
        });

        await nodeSeed.ensureLoaded();
        await nodeSeed.bootstrap();

        await node2.ensureLoaded();
        await node2.bootstrap();

        await sleep(2000);

        await node3.ensureLoaded();
        await node3.bootstrap();
    });

    after(async function () {
        this.timeout(15000);
    });

    it('should connect both node to seed', async () => {
        const arrPeers = nodeSeed._peerManager.getConnectedPeers();

        assert.equal(arrPeers.length, 2);
    });

    it('should announce node2 to node3 via seed', async () => {
        const arrPeers = node3._peerManager.filterPeers(undefined, true);

        assert.equal(arrPeers.length, 2);
        assert.equal(arrPeers[0].port, factory.Constants.port);
        assert.equal(arrPeers[1].port, 22222);
    });
});
