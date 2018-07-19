const {describe, it} = require('mocha');
const {assert} = require('chai');
const oneTime=require('one-time');

const TestTrasport=require('../transports/testTransport');

const sleep = (delay) => {
    return new Promise(resolve => {
        setTimeout(() => resolve(), delay);
    });
};

describe('TestTransport', () => {
    before(async function() {
        this.timeout(15000);
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should communicate each other', (done) => {
        const oneTimeDone=oneTime(done);
        const message={a:1};
        const endpoint1=new TestTrasport({delay: 0.5});
        const endpoint2=new TestTrasport({delay: 1});

        endpoint1.listen('address');
        endpoint1.on('connect', async connection1=>{

            // need to wait till connection2 assign listener
            await sleep(1000);
            connection1.sendMessage(message);
        });

        endpoint2.connect('address').then(connection2 =>{
            connection2.on('message', (receivedMsg) =>{
                assert.deepEqual(message, receivedMsg);
                oneTimeDone();
            });
        });

    });

    it('should not communicate (different addresses)', function(done) {
        const oneTimeDone=oneTime(done);
        const message={a:1};
        const endpoint1=new TestTrasport({delay: 0.5});
        const endpoint2=new TestTrasport({delay: 1});

        endpoint1.listen('address');
        endpoint1.on('connect', async connection1=>{

            // need to wait till connection2 assign listener
            await sleep(1000);
            connection1.sendMessage(message);
        });

        endpoint2.connect('address').then(connection2 =>{
            connection2.on('message', (receivedMsg) =>{
                assert.deepEqual(message, receivedMsg);
                oneTimeDone();
            });
        });

        sleep(3000).then(oneTimeDone);
    });

    it('should simulate network latency (3 sec)',  function(done) {
        this.timeout(15000);

        const oneTimeDone=oneTime(done);
        const message={a:1};
        const endpoint1=new TestTrasport({delay: 0.5});
        const endpoint2=new TestTrasport({delay: 1});

        endpoint1.listen('address');
        endpoint1.on('connect', async connection1=>{

            // need to wait till connection2 assign listener
            await sleep(1000);
            connection1.sendMessage(message);
        });

        endpoint2.connect('address').then(connection2 =>{
            connection2.on('message', (receivedMsg) =>{
                assert.deepEqual(message, receivedMsg);
                oneTimeDone();
            });
        });

        sleep(5000).then(() => oneTimeDone(new Error('Unexpected! timeout reached')));
    });
});
