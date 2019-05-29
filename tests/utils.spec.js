'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const {prepareForStringifyObject, arrayIntersection, mergeSets} = require('../utils');

describe('Utils', () => {
    describe('prepareForStringifyObject', () => {
        it('should leave unchanged non Objects and Arrays', async () => {
            assert.equal(undefined, prepareForStringifyObject(undefined));
            assert.equal('test', prepareForStringifyObject('test'));
            assert.equal(1, prepareForStringifyObject(1));
            assert.equal(false, prepareForStringifyObject(false));
            assert.deepEqual([1, 2, 3, 4], prepareForStringifyObject([1, 2, 3, 4]));
        });
        it('should transform Buffer', async () => {
            assert.equal('dead', prepareForStringifyObject(Buffer.from('DEAD', 'hex')));
        });
        it('should transform Array of Buffers', async () => {
            const result = prepareForStringifyObject([
                Buffer.from('DEAD', 'hex'),
                Buffer.from('EDAA', 'hex')
            ]);
            assert.deepEqual(['dead', 'edaa'], result);
        });
        it('should transform nested object', async () => {
            const result = prepareForStringifyObject({
                object: {
                    buffer: Buffer.from('DEAD', 'hex'),
                    arrBuffers: [
                        Buffer.from('DEAD', 'hex'),
                        Buffer.from('EDAA', 'hex')
                    ]
                }
            });
            assert.deepEqual({object: {buffer: 'dead', arrBuffers: ['dead', 'edaa']}}, result);
        });
        it('should leave primitives unchanged', async () => {
            const expected = {
                number: 1,
                string: 'string',
                boolean: true
            };
            const result = prepareForStringifyObject(expected);
            assert.deepEqual(expected, result);
        });
    });
    describe('array intersection', () => {
        it('should intersect 2 empty', async () => {
            const arr1 = [];
            const arr2 = [];
            assert.deepEqual(arrayIntersection(arr1, arr2), []);
        });

        it('should intersect 1 empty', async () => {
            const arr1 = [1, 2, 3, 4];
            const arr2 = [];
            assert.deepEqual(arrayIntersection(arr1, arr2), []);
            assert.deepEqual(arrayIntersection(arr2, arr1), []);
        });
        it('should empty for non intersecting', async () => {
            const arr1 = [1, 2, 3, 4];
            const arr2 = [10, 11, 12];
            assert.deepEqual(arrayIntersection(arr1, arr2), []);
            assert.deepEqual(arrayIntersection(arr2, arr1), []);
        });
        it('should find intersection', async () => {
            const arr1 = [1, 2, 3, 4];
            const arr2 = [1, 10, 11, 12];
            assert.deepEqual(arrayIntersection(arr1, arr2), [1]);
            assert.deepEqual(arrayIntersection(arr2, arr1), [1]);
        });
    });
    describe('merge sets', () => {
        it('should merge it', async () => {
            const set1 = new Set([1, 2, 3, 4]);
            const set2 = new Set([11, 12, 13, 14]);
            assert.deepEqual([...mergeSets(set1, set2)], [1, 2, 3, 4, 11, 12, 13, 14]);
            assert.deepEqual([...mergeSets(set2, set1)], [11, 12, 13, 14, 1, 2, 3, 4]);
        });
    });
});
