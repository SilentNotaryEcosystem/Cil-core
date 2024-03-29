'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('../testFactory');
const {createDummyBlock} = require('../testUtil');

describe('BlockInfo tests', () => {
    let blockInfo;
    let block;

    before(async function () {
        await factory.asyncLoad();
    });

    beforeEach(async function () {
        block = createDummyBlock(factory);
        blockInfo = new factory.BlockInfo(block.header);
    });

    it('should fail to CREATE from empty', async () => {
        assert.throws(() => new factory.BlockInfo());
    });

    it('should CREATE from block header', async () => {
        assert.isNotOk(blockInfo.isBad());
    });

    it('should calculate hash', async () => {
        assert.equal(blockInfo.getHash(), block.getHash());
    });

    it('should mark as BAD', async () => {
        assert.isNotOk(blockInfo.isBad());
        blockInfo.markAsBad();
        assert.isOk(blockInfo.isBad());
    });

    it('should encode/decode', async () => {
        blockInfo.markAsBad();
        const buff = blockInfo.encode();

        const restored = new factory.BlockInfo(buff);
        assert.isOk(restored.isBad());
        assert.isOk(blockInfo.getHeader().merkleRoot.equals(restored.getHeader().merkleRoot));
    });
});
