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
        const endpoint1=new TestTrasport({delay: 0.5});
        const endpoint2=new TestTrasport({delay: 1});
        endpoint1.listen('address');
        endpoint2.connect('address');
        const message={a:1};

        endpoint2.on('message', (receivedMsg) =>{
            assert.deepEqual(message, receivedMsg);
            oneTimeDone();
        });
        endpoint1.sendMessage(message);
    });

    it('should not communicate (different addresses)', function(done) {
        const oneTimeDone=oneTime(done);

        this.timeout(15000);
        const endpoint1=new TestTrasport({delay: 0.5});
        const endpoint2=new TestTrasport({delay: 1});
        endpoint1.listen('address');
        endpoint2.connect('address2');
        const message={a:1};

        endpoint2.on('message', (receivedMsg) =>{
            assert.deepEqual(message, receivedMsg);
            const error=new Error('Unexpected success');
            oneTimeDone(error);
        });
        endpoint1.sendMessage(message);
        sleep(3000).then(oneTimeDone);
    });

    it('should simulate network latency (3 sec)',  function(done) {
        const oneTimeDone=oneTime(done);
        this.timeout(15000);
        const endpoint1=new TestTrasport({delay: 0.5});
        const endpoint2=new TestTrasport({delay: 3});
        endpoint1.listen('address');
        endpoint2.connect('address');
        const message={a:1};

        endpoint2.on('message', (receivedMsg) =>{
            assert.deepEqual(message, receivedMsg);
            oneTimeDone();
        });
        endpoint1.sendMessage(message);
        sleep(5000).then(() => oneTimeDone(new Error('Unexpected! timeout reached')));
    });
});
