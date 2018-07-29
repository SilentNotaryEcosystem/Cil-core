const {describe, it} = require('mocha');
const {assert} = require('chai');

const TestTrasport = require('../network/testTransport');
const {sleep} = require('../utils');

describe('TestTransport', () => {
    before(async function() {
        this.timeout(15000);
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should communicate each other', async () => {
        const message = {a: 1};
        const endpoint1 = new TestTrasport({delay: 200});
        const endpoint2 = new TestTrasport({delay: 200});

        const [connection1, connection2] = await Promise.all([
            endpoint1.listenSync('address'),
            endpoint2.connect('address')
        ]);

        const msgPromise=connection2.receiveSync();
        connection1.sendMessage(message);

        const result=await msgPromise;
        assert.deepEqual(message, result);
    });

    it('should timeout 3 sec (different addresses)', async function () {
        this.timeout(5000);

        const test = async () => {
            const message = {a: 1};
            const endpoint1 = new TestTrasport({delay: 200});
            const endpoint2 = new TestTrasport({delay: 200});

            const [connection1, connection2] = await Promise.all([
                endpoint1.listenSync('address'),
                endpoint2.connect('address2')
            ]);

            const msgPromise = connection2.receiveSync();
            connection1.sendMessage(message);

            return await msgPromise;
        };

        // test() will hang since there is different addresses
        const result=await Promise.race([test(), sleep(3000)]);

        // timeout reached & sleep returns undefined
        assert.isNotOk(result);
    });

    it('should simulate network latency (3 sec)',  async function () {
        this.timeout(10000);
        const message = {a: 1};

        const test = async () => {
            const endpoint1 = new TestTrasport({delay: 0});

            // 1500 msec for connect & 1500 msec for message
            const endpoint2 = new TestTrasport({delay: 1500});

            const [connection1, connection2] = await Promise.all([
                endpoint1.listenSync('address'),
                endpoint2.connect('address')
            ]);

            const msgPromise = connection2.receiveSync();
            connection1.sendMessage(message);

            return await msgPromise;
        };

        const tsStarted=Date.now();
        const result=await Promise.race([test(), sleep(5000)]);
        const tsFinished=Date.now();

        assert.isOk(result);
        assert.deepEqual(result, message);
        assert.isOk(tsFinished-tsStarted > 3000);
    });
});
