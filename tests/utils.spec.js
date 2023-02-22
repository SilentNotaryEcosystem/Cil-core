'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');
const nock = require('nock');

const factory = require('./testFactory');
const {
    getBoolEnvParameter,
    deStringifyObject, prepareForStringifyObject, arrayIntersection,
    mergeSets, decryptPkFileContent, queryRpc, getHttpData,
    mapEnvToOptions,
    ExceptionDebug, ExceptionLog
} = require('../utils');

describe('Utils', () => {
    before(async () => {
        await factory.asyncLoad();
    });

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
    describe('deStringifyObject', () => {
        it('should leave primitives unchanged', async () => {
            assert.strictEqual(deStringifyObject(1), 1);
            assert.strictEqual(deStringifyObject('test'), 'test');
            assert.strictEqual(deStringifyObject(true), true);
        });

        it('should leave Array of primitives unchanged', async () => {
            assert.deepEqual(deStringifyObject([1, 2, 'test', true]), [1, 2, 'test', true]);
        });

        it('should leave Array of hex string transformed', async () => {
            const arr = [
                'befbd505931f2d3058e13bef4081f538e893edaebb2f8eb658f70f6bf726d8c3',
                '258b5564f9f539fc749a336d0ccafa3032fe16ab5564cb71b608d25bf14322bc',
                'test'
            ];

            const result = deStringifyObject(arr);

            assert.deepEqual(prepareForStringifyObject(result), arr);
        });

        it('should transform hex strings into Buffer', async () => {
            const str = 'befbd505931f2d3058e13bef4081f538e893edaebb2f8eb658f70f6bf726d8c3';

            const result = deStringifyObject(str);

            assert.isOk(Buffer.isBuffer(result));
            assert.strictEqual(result.toString('hex'), str);
        });

        it('should transform object', async () => {
            const obj = {
                str: 'befbd505931f2d3058e13bef4081f538e893edaebb2f8eb658f70f6bf726d8c3'
            };

            const result = deStringifyObject(obj);

            assert.deepEqual(prepareForStringifyObject(result), obj);
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

    describe('read private key from file', () => {
        it('should read V1 PK (concatenated string created on front)', async () => {
            const encryptedKey = '9003b3a7af0ff553d4e716b8b3c7cc823696fdcfae431c8fcc049a32444fd8c8gYkDoz15J7su/Y/RhywnjrDzmEDXlzoaGFI4Uz0CEF2LmYf4ZvINj7C1AFkojXp0DraELnJuCu7y3HQA21H7Klnc4q2zi333m6ViI0g8bfc=';
            const password = 'aA1!111111';

            const strPk = decryptPkFileContent(factory.Crypto, encryptedKey, password);
            assert.equal(strPk, 'e673dd93e8b1142ea6793bf879c4a5a94155d377b86e54ce2acc55372f3ca66d');
        });

        it('should read V2 PK (scrypt json)', async () => {
            const encryptedFileContent = {
                iv: '12121b180ff15d036a0910e52dbc2317',
                encrypted: '295ebe4131a8b1d1d7440ecffe0eaee1e9f979370a20e39fe39186b45313d2a7ef24bcf4b58bd7e36defb4f977ff6526',
                salt: '60236cd090ab566cf03bfe796eeb9516',
                hashOptions: {N: 16384, p: 1},
                keyAlgo: 'scrypt'
            };
            const password = '234';

            const strPk = decryptPkFileContent(factory.Crypto, JSON.stringify(encryptedFileContent), password);
            assert.equal(strPk, 'ed8dffbc70d791dd325215f2df9053fb253217815d0804846eab83d513da182c');
        });

        it('should read V2 PK (pbkdf2 json)', async () => {
            const encryptedFileContent = {
                iv: 'ea956ef70cc1142552d1bdbc315fcf05',
                encrypted: '75862991394101b5da8324d475cb0514790abf0800160b187eaa9f1090ae5fb02dc87cc3c7a8369b7a9b9c4d8f09a06c',
                salt: '1a135740efad0a2753489a6d29af0fd1',
                hashOptions: {iterations: 100000},
                keyAlgo: 'pbkdf2'
            };
            const password = '234';

            const strPk = decryptPkFileContent(factory.Crypto, JSON.stringify(encryptedFileContent), password);
            assert.equal(strPk, 'ee56a32dc79322c94fd832ce7c4309298beda8d7c28f7e35f3e3e47e89562c90');
        });
    });

    describe('queryRpc', () => {
        it('should send transaction (empty response)', async () => {
            const strTx = '0a440a240a20b3982f49472e41021d96090cd0579da23317cf865f4f5f75e8c783955df4897d1000120b0901000000000000001200120b090f3d3ba40b0000001200180120001241d19ffda43e6121f902e60a0b35a5b97de38000cac9f016e5f21c857026ebdf8978c1c9a081c26fcbdbc54dda564b94f427d26d642b0ce4a0eef8ca8b39a3dafa00';
            const strUrlRpc = 'http://localhost:8222/';
            nock(strUrlRpc)
                .post('/', body => body.method === 'sendRawTx' && body.params.strTx === strTx)
                .reply(200);

            const result = await queryRpc(strUrlRpc, 'sendRawTx', {strTx});

            assert.isNull(result);
        });

        it('should send transaction (obj response)', async () => {
            const strTx = '0a440a240a20b3982f49472e41021d96090cd0579da23317cf865f4f5f75e8c783955df4897d1000120b0901000000000000001200120b090f3d3ba40b0000001200180120001241d19ffda43e6121f902e60a0b35a5b97de38000cac9f016e5f21c857026ebdf8978c1c9a081c26fcbdbc54dda564b94f427d26d642b0ce4a0eef8ca8b39a3dafa00';
            const strUrlRpc = 'http://localhost:8222/';
            const response = {result: {test: 1}};

            nock(strUrlRpc)
                .post('/', body => body.method === 'sendRawTx' && body.params.strTx === strTx)
                .reply(200, response);

            const result = await queryRpc(strUrlRpc, 'sendRawTx', {strTx});

            assert.deepEqual(result, response.result);
        });
    });

    describe('getHttpData', () => {
        it('should query (empty response)', async () => {
            const strUrlApi = 'http://localhost/path?query=1';
            nock('http://localhost/')
                .get('/path?query=1')
                .reply(200);

            const result = await getHttpData(strUrlApi);

            assert.deepEqual(result, {});
        });

        it('should send transaction (obj response)', async () => {
            const strUrlApi = 'https://explorer.ubikiri.com/api/Balance/Ux27598a817806a3715e0fbb7c418f45ac337bb111';
            const response = {result: {test: 1}};

            nock('https://explorer.ubikiri.com/')
                .get('/api/Balance/Ux27598a817806a3715e0fbb7c418f45ac337bb111')
                .reply(200, response);

            const result = await getHttpData(strUrlApi);

            assert.deepEqual(result, response);
        });
    });

    describe('getBoolEnvParameter', () => {
        it('should be FALSE for unset', async () => {
            assert.strictEqual(getBoolEnvParameter(undefined), false);
        });
        it('should be FALSE for "0"', async () => {
            assert.strictEqual(getBoolEnvParameter("0"), false);
            assert.strictEqual(getBoolEnvParameter(" 0 "), false);
        });
        it('should be FALSE for "false"', async () => {
            assert.strictEqual(getBoolEnvParameter("false"), false);
            assert.strictEqual(getBoolEnvParameter(" false "), false);
        });
        it('should be TRUE for "1"', async () => {
            assert.strictEqual(getBoolEnvParameter("1"), true);
            assert.strictEqual(getBoolEnvParameter(" 1 "), true);
        });
        it('should be TRUE for "true"', async () => {
            assert.strictEqual(getBoolEnvParameter("true"), true);
            assert.strictEqual(getBoolEnvParameter(" true "), true);
        });
    });

    describe('mapEnvToOptions', async () => {
        it('should undefined for LISTEN_PORT, WHITELISTED_ADDR, ANNOUNCE_PORT', async () => {
            process.env = {
                ...process.env,
                LISTEN_PORT: undefined,
                WHITELISTED_ADDR: undefined,
                ANNOUNCE_PORT: undefined
            };
            const {port, whitelistedAddr, announcePort} = mapEnvToOptions();

            assert.isNotOk(port);
            assert.isNotOk(whitelistedAddr);
            assert.isNotOk(announcePort);
        });

        it('should get LISTEN_PORT, WHITELISTED_ADDR, ANNOUNCE_PORT', async () => {
            const arrAddrs = ['1.1.1.1', '8.8.8.8/32'];
            process.env = {
                ...process.env,
                LISTEN_PORT: '100500',
                WHITELISTED_ADDR: arrAddrs.join(' '),
                ANNOUNCE_PORT: '322'
            };
            const {port, whitelistedAddr, announcePort} = mapEnvToOptions();

            assert.equal(port, parseInt(process.env.LISTEN_PORT));
            assert.deepEqual(whitelistedAddr, arrAddrs);
            assert.equal(announcePort, parseInt(process.env.ANNOUNCE_PORT));
        });

        it('should read default KEYSTORE_NAME', async () => {
            process.env = {
                ...process.env,
                KEYSTORE_NAME: undefined,
                WITNESS_NODE: 'true'
            };

            const {privateKey} = mapEnvToOptions();

            assert.equal(privateKey, './private');
        });

        it('should use KEYSTORE_NAME', async () => {
            process.env = {
                ...process.env,
                KEYSTORE_NAME: '/fake_file_name',
                WITNESS_NODE: 'true'
            };

            const {privateKey} = mapEnvToOptions();

            assert.equal(privateKey, process.env.KEYSTORE_NAME);
        });
    });

    it('should read RPC_RATE', async () => {
        process.env = {
            ...process.env,
            RPC_RATE: '1000',
        };

        const {rpcRate} = mapEnvToOptions();

        assert.equal(rpcRate, parseInt(process.env.RPC_RATE));
    });

    describe('Exceptions', async () => {
        it('should create ExceptionDebug', async () => {
            const e = new ExceptionDebug('debug');
            e.log();

            assert.isOk(e.message);
            assert.isOk(e.stack);
        });

        it('should create ExceptionLog', async () => {
            const e = new ExceptionLog('log');
            e.log();

            assert.isOk(e.message);
            assert.isOk(e.stack);
        });

        it('should create Error', async () => {
            const e = new Error('error');
            e.log();

            assert.isOk(e.message);
            assert.isOk(e.stack);
        });
    });
});
