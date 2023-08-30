const {describe, it} = require('mocha');
const {assert} = require('chai');

factory = require('./testFactory');

describe('Message assembly (part of connection)', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should pass (1 message - 1 chunk)', async () => {
        const msg = new factory.Messages.MsgCommon;
        msg.payload = Buffer.from('a'.repeat(1024));
        const assembler = new factory.MessageAssembler;
        const encodedMsg = msg.encode();

        const arrMessages = assembler.extractMessages(encodedMsg);
        assert.isOk(arrMessages && arrMessages.length === 1);
        assert.isOk(Buffer.isBuffer(arrMessages[0]));
        assert.isOk(arrMessages[0].equals(encodedMsg));
        assert.isOk(assembler.isDone);
    });

    it('should pass (1 message - 2 chunks)', async () => {
        const msg = new factory.Messages.MsgCommon;
        msg.payload = Buffer.from('a'.repeat(1024));
        const assembler = new factory.MessageAssembler;
        const encodedMsg = msg.encode();
        const part1 = encodedMsg.slice(0, 3);
        const part2 = encodedMsg.slice(3);

        const arrResult1 = assembler.extractMessages(part1);
        assert.isNotOk(arrResult1);
        assert.isNotOk(assembler.isDone);
        const arrResult2 = assembler.extractMessages(part2);
        assert.isOk(arrResult2 && arrResult2.length === 1);
        assert.isOk(Buffer.isBuffer(arrResult2[0]));
        assert.isOk(arrResult2[0].equals(encodedMsg));
        assert.isOk(assembler.isDone);
    });

    it('should pass (2 messages - 2 chunks)', async () => {
        const msg = new factory.Messages.MsgCommon;
        msg.payload = Buffer.from('a'.repeat(1024));
        const assembler = new factory.MessageAssembler;
        const encodedMsg = msg.encode();

        // full message + 3 bytes of next
        const chunk = Buffer.concat([encodedMsg, encodedMsg.slice(0, 1)]);

        {
            const arrMessages = assembler.extractMessages(chunk);
            assert.isOk(arrMessages && arrMessages.length === 1);
            assert.isOk(Buffer.isBuffer(arrMessages[0]));
            assert.isOk(arrMessages[0].equals(encodedMsg));
            assert.isNotOk(assembler.isDone);
        }

        {
            const arrMessages = assembler.extractMessages(encodedMsg.slice(1));
            assert.isOk(arrMessages && arrMessages.length === 1);
            assert.isOk(Buffer.isBuffer(arrMessages[0]));
            assert.isOk(arrMessages[0].equals(encodedMsg));
            assert.isOk(assembler.isDone);
        }
    });

    it('should pass (2 message - 1 chunks)', async () => {
        const msg = new factory.Messages.MsgCommon;
        msg.payload = Buffer.from('a'.repeat(1024));
        const assembler = new factory.MessageAssembler;
        const encodedMsg = msg.encode();

        // full message + 3 bytes of next
        const chunk = Buffer.concat([encodedMsg, encodedMsg]);

        const arrMessages = assembler.extractMessages(chunk);
        assert.isOk(arrMessages && arrMessages.length === 2);
        assert.isOk(Buffer.isBuffer(arrMessages[0]) && Buffer.isBuffer(arrMessages[1]));
        assert.isOk(arrMessages[0].equals(encodedMsg));
        assert.isOk(arrMessages[1].equals(encodedMsg));
        assert.isOk(assembler.isDone);
    });

    it('should pass (3 messages - 1 chunk. wait for next chunk)', async () => {
        const msg = new factory.Messages.MsgCommon;
        msg.payload = Buffer.from('a'.repeat(1024));
        const assembler = new factory.MessageAssembler;
        const encodedMsg = msg.encode();

        // 2 full message + 3 bytes of next
        const chunk = Buffer.concat([encodedMsg, encodedMsg, encodedMsg.slice(0, 3)]);

        const arrMessages = assembler.extractMessages(chunk);
        assert.isOk(arrMessages && arrMessages.length === 2);
        assert.isOk(Buffer.isBuffer(arrMessages[0]) && Buffer.isBuffer(arrMessages[1]));
        assert.isOk(arrMessages[0].equals(encodedMsg));
        assert.isOk(arrMessages[1].equals(encodedMsg));
        assert.isNotOk(assembler.isDone);
    });

    it('should pass (2 message - 3 chunks)', async () => {
        const msg = new factory.Messages.MsgCommon;
        msg.payload = Buffer.from('a'.repeat(1024));
        const msg2 = new factory.Messages.MsgCommon;
        msg2.payload = Buffer.from('1234567890');
        const assembler = new factory.MessageAssembler;
        const encodedMsg = msg.encode();
        const encodedMsg2 = msg2.encode();
        const part1 = encodedMsg.slice(0, 3);
        const part2 = Buffer.concat([encodedMsg.slice(3), encodedMsg2.slice(0, 3)]);
        const part3 = encodedMsg2.slice(3);

        const arrResult1 = assembler.extractMessages(part1);
        assert.isNotOk(arrResult1);
        assert.isNotOk(assembler.isDone);

        const arrResult2 = assembler.extractMessages(part2);
        assert.isOk(arrResult2 && arrResult2.length === 1);
        assert.isOk(Buffer.isBuffer(arrResult2[0]));
        assert.isOk(arrResult2[0].equals(encodedMsg));
        assert.isNotOk(assembler.isDone);

        const arrResult3 = assembler.extractMessages(part3);
        assert.isOk(arrResult3 && arrResult3.length === 1);
        assert.isOk(Buffer.isBuffer(arrResult3[0]));
        assert.isOk(arrResult3[0].equals(encodedMsg2));
        assert.isOk(assembler.isDone);
    });

});
