// part of protobuff
const Long = require('long');
const readline = require('readline');
const fs = require('fs');
const commandLineArgs = require('command-line-args');
const v8 = require('v8');
const http = require('http');
const https = require('https');

class ExceptionDebug extends Error {
    constructor(strMsg) {
        super(strMsg);
    }

    log() {
        logger.debug(this);
    }
}

class ExceptionLog extends Error {
    constructor(strMsg) {
        super(strMsg);
    }

    log() {
        logger.log(this);
    }
}

/**
 *
 * @param {Array} arrNumbers
 * @returns {number}
 * @constructor
 */
function GCD(arrNumbers) {
    let x = Math.abs(arrNumbers[0]);
    for (let i = 1; i < arrNumbers.length; i++) {
        let y = Math.abs(arrNumbers[i]);
        while (x && y) { x > y ? x %= y : y %= x; }
        x += y;
    }
    return x;
}

const createPeerTag = (nConciliumId) => {
    return `wg${nConciliumId}`;
};

const deepCloneObject = (objToClone) => {
    return v8.deserialize(v8.serialize(objToClone));
};

const arrayIntersection = (array1, array2) => {
    const cache = new Set(array1);
    return array2.filter(elem => cache.has(elem));
};

const queryRpc = async (url, strMethod, objParams = {}) => {

    const options = {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        }
    };

    const objBody = {
        jsonrpc: '2.0',
        method: strMethod,
        params: objParams,
        id: 67
    };

    const chunks = [];
    const {result} = await new Promise((resolve, reject) => {
        const req = http.request(url, options, res => {
            res.on("data", (chunk) => {
                chunks.push(chunk);
            });

            res.on("end", () => {
                const buffBody = Buffer.concat(chunks);
                const result = buffBody.length ? JSON.parse(buffBody.toString()) : {result: null};
                resolve(result);
            });

            req.on('error', (e) => {
                reject(e);
            });
        });

        req.write(JSON.stringify(objBody));
        req.end();
    });

    return result;
};

const getHttpData = async (url) => {
    const options = {
        method: "GET",
        headers: {
            "Content-Type": "application/json"
        },

        // test-explorer has an issue with cert
        rejectUnauthorized: false
    };

    const transport = url.match(/^https/) ? https : http;

    const chunks = [];
    const result = await new Promise((resolve, reject) => {
        const req = transport.request(url, options, res => {
            res.on("data", (chunk) => {
                chunks.push(chunk);
            });

            res.on("end", () => {
                const buffBody = Buffer.concat(chunks);
                const result = buffBody.length ? JSON.parse(buffBody.toString()) : {};
                resolve(result);
            });

            req.on('error', (e) => {
                reject(e);
            });
        });

        req.end();
    });

    return result;
};

const prepareForStringifyObject = (obj) => {
    if (!(obj instanceof Object)) return obj;

    if (Buffer.isBuffer(obj)) return obj.toString('hex');
    if (Array.isArray(obj)) return obj.map(elem => prepareForStringifyObject(elem));

    const resultObject = {};
    for (let key of Object.keys(obj)) {
        if (typeof obj[key] === 'function' || typeof obj[key] === 'undefined') continue;

        if (Buffer.isBuffer(obj[key])) {
            resultObject[key] = obj[key].toString('hex');
        } else if (Array.isArray(obj[key])) {
            resultObject[key] = prepareForStringifyObject(obj[key]);
        } else if (Long.isLong(obj[key])) {
            resultObject[key] = obj[key].toNumber();
        } else if (obj[key] instanceof Object) {
            resultObject[key] = prepareForStringifyObject(obj[key]);
        } else {
            resultObject[key] = obj[key];
        }
    }
    return resultObject;
};

/**
 *
 * @param arrUtxos
 * @param bStable
 * @param mapUtxoAddr
 * @param mapTxBlock
 * @return {[{hash, nOut, amount, isStable}]}
 */
const finePrintUtxos = (arrUtxos, bStable, mapUtxoAddr, mapTxBlock) => {
    const arrResult = [];
    arrUtxos.forEach(utxo => {
        utxo.getIndexes()
            .map(idx => [idx, utxo.coinsAtIndex(idx)])
            .forEach(([idx, coins]) => {
                const strReceiver = mapUtxoAddr ? mapUtxoAddr.get(utxo) : undefined;
                arrResult.push({
                    hash: utxo.getTxHash(),
                    nOut: idx,
                    amount: coins.getAmount(),
                    isStable: bStable,
                    receiver: strReceiver,
                    block: mapTxBlock ? mapTxBlock.get(utxo.getTxHash()) : undefined
                });
            });
    });
    return arrResult;
};

/**
 * All hex strings should be transformed into buffers
 *
 * @param {Object} obj
 * @returns {Buffer|*}
 */
const deStringifyObject = (obj) => {
    if (typeof obj === 'string') {
        const buff = Buffer.from(obj, 'hex');
        if (buff.length * 2 === obj.length) return buff;
        return obj;
    } else if (obj instanceof Object) {
        const resultObject = {};

        if (Array.isArray(obj)) return obj.map(el => deStringifyObject(el));

        for (let key of Object.keys(obj)) {
            if (typeof obj[key] === 'function' || typeof obj[key] === 'undefined') continue;
            resultObject[key] = deStringifyObject(obj[key]);
        }
        return resultObject;
    } else {
        return obj;
    }
};

/**
 * Duplicates are possible!
 *
 * @param {Array} arrMaps of Maps
 * @return {Array} keys
 */
const getMapsKeys = (...arrMaps) => {
    let arrResultKeys = [];
    for (let map of arrMaps) {
        arrResultKeys = arrResultKeys.concat(Array.from(map.keys()));
    }
    return arrResultKeys;
};

function questionAsync(prompt, password = false) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(prompt, answer => {
            rl.close();
            if (password) {
                if (process.stdout.moveCursor) process.stdout.moveCursor(0, -1);
                if (process.stdout.clearLine) process.stdout.clearLine();
            }
            resolve(answer.trim());
        });
    });
}

function decryptPkFileContent(Crypto, fileContent, password) {
    let objEncodedData;
    let encoding = 'hex';

    try {
        objEncodedData = JSON.parse(fileContent);
    } catch (e) {

        // V1: concatenated salt, iv, base64Encoded
        const salt = fileContent.substr(0, 32);
        const iv = fileContent.substr(32, 32);
        const encrypted = Buffer.from(fileContent.substring(64), 'base64');

        objEncodedData = {
            iv,
            encrypted,
            salt,
            hashOptions: {iterations: 100},
            keyAlgo: 'pbkdf2'
        };

        // decrypted value will be neither 32 byte length buffer, nor hex String of length 64, but 64 byte length Buffer
        encoding = undefined;
    }

    return Crypto.decrypt(password, objEncodedData).toString(encoding);
}

/**
 * Designed to pass values to Docker container
 * So, other option have no use in Docker deployment
 *
 * @returns Object
 */
function mapEnvToOptions() {

    const {
        TRUST_ANNOUNCE, ANNOUNCE_ADDRESS, ANNOUNCE_PORT, LISTEN_ADDR, LISTEN_PORT,
        SEED_ADDRESS, RPC_ADDRESS, RPC_USER, RPC_PASS, RPC_RATE,
        GENESIS_HASH, CONCILIUM_CONTRACT,
        WITNESS_NODE, SEED_NODE, BUILD_TX_INDEX, WALLET_SUPPORT, SUPPRESS_JOIN_TX,
        WHITELISTED_ADDR,
        KEYSTORE_NAME
    } = process.env;

    return {
        whitelistedAddr: WHITELISTED_ADDR ? WHITELISTED_ADDR.split(/\s/) : undefined,
        trustAnnounce: getBoolEnvParameter(TRUST_ANNOUNCE),

        announceAddr: ANNOUNCE_ADDRESS,
        announcePort: parseInt(ANNOUNCE_PORT),

        listenAddr: LISTEN_ADDR,
        port: parseInt(LISTEN_PORT),

        // if you plan to send TXns through your node
        rpcUser: RPC_USER,
        rpcPass: RPC_PASS,
        rpcAddress: RPC_ADDRESS,
        rpcRate: parseInt(RPC_RATE),

        // if you plan to query your node
        txIndex: getBoolEnvParameter(BUILD_TX_INDEX),
        walletSupport: getBoolEnvParameter(WALLET_SUPPORT),

        // WITNESS_NODE is a Boolean variable, indicating witness node.
        // Just mount your real file name into container /app/private
        privateKey: getBoolEnvParameter(WITNESS_NODE) ? (KEYSTORE_NAME ? KEYSTORE_NAME : './private') : undefined,
        seed: getBoolEnvParameter(SEED_NODE),

        suppressJoinTx: getBoolEnvParameter(SUPPRESS_JOIN_TX),

        // Variables below used for development, regular user don't need it
        // SEED_ADDRESS - string containing ONLY ONE address (IP or DNS) see
        //    mapOptionsToNodeParameters
        seedAddr: SEED_ADDRESS,
        genesisHash: GENESIS_HASH,
        conciliumDefContract: CONCILIUM_CONTRACT,
    };
}

function getBoolEnvParameter(value) {
    return !!(
        value && typeof value === 'string' &&
        (value.trim().toLowerCase() === 'true' || parseInt(value) === 1)
    );
}

/**
 * Maps user-defined parameters into Node parameters names
 *
 * @param {Object} objUserParams from command line or ENV
 * @returns Object
 */
function mapOptionsToNodeParameters(objUserParams) {
    return {

        // if command line parameter have same name as option name, like "rpcUser"
        ...objUserParams,

        // non matching names
        buildTxIndex: objUserParams.txIndex,
        listenPort: objUserParams.port,
        arrSeedAddresses: objUserParams.seedAddr ? [objUserParams.seedAddr] : [],
        isSeed: objUserParams.seed
    };
}

module.exports = {
    sleep: (delay) => {
        return new Promise(resolve => {
            setTimeout(resolve, delay);
        });
    },
    arrayIntersection,

    // order is not guaranteed! only equality of content
    arrayEquals: (array1, array2) => {
        return array1.length === array2.length && arrayIntersection(array1, array2).length === array1.length;
    },

    mergeSets: (set1, set2) => {
        return new Set([...set1, ...set2]);
    },

    getMapsKeys,

    getMapsKeysUnique: (...arrMaps) => {
        let tempSet = new Set(getMapsKeys(...arrMaps));
        return Array.from(tempSet.keys());
    },

    timestamp: () => {
        return parseInt(Date.now() / 1000);
    },

    asyncRPC: fn => (arg, opt, cb) => {
        fn(arg, opt)
            .then(result => cb(null, result))
            .catch(cb);
    },

    readCmdLineOptions: () => {
        const optionDefinitions = [
            {name: "trustAnnounce", type: Boolean, multiple: false},
            {name: "announceAddr", type: String, multiple: false},
            {name: "announcePort", type: Number, multiple: false},
            {name: "listenAddr", type: String, multiple: false},
            {name: "port", type: Number, multiple: false},
            {name: "seedAddr", type: String, multiple: false},
            {name: "rpcUser", type: String, multiple: false},
            {name: "rpcPass", type: String, multiple: false},
            {name: "rpcPort", type: Number, multiple: false},
            {name: "rpcRate", type: Number, multiple: false},
            {name: "rpcAddress", type: String, multiple: false},
            {name: "genesisHash", type: String, multiple: false},
            {name: "conciliumDefContract", type: String, multiple: false},
            {name: "privateKey", type: String, multiple: false},
            {name: "dbPath", type: String, multiple: false},
            {name: "seed", type: Boolean, multiple: false},
            {name: "strictAddresses", type: Boolean, multiple: false},
            {name: "txIndex", type: Boolean, multiple: false},
            {name: "watchAddress", type: String, multiple: true},
            {name: "reIndexWallet", type: Boolean, multiple: false},
            {name: "walletSupport", type: Boolean, multiple: false},
            {name: "listWallets", type: Boolean, multiple: false},
            {name: "localDevNode", type: Boolean, multiple: false},
            {name: "rebuildDb", type: Boolean, multiple: false},
            {name: "whitelistedAddr", type: String, multiple: true},
            {name: "suppressJoinTx", type: Boolean, multiple: false}
        ];
        return commandLineArgs(optionDefinitions, {camelCase: true});
    },

    prepareForStringifyObject,
    deStringifyObject,

    questionAsync,
    deepCloneObject,

    queryRpc,
    getHttpData,

    pick(obj, keys) {
        return keys.map(k => k in obj ? {[k]: obj[k]} : {})
            .reduce((res, o) => Object.assign(res, o), {});
    },

    stripAddressPrefix(Constants, strAddr) {
        return strAddr && strAddr.startsWith(Constants.ADDRESS_PREFIX) ?
            strAddr.substring(Constants.ADDRESS_PREFIX.length)
            : strAddr;
    },

    async readPrivateKeyFromFile(Crypto, path) {
        const encodedContent = fs.readFileSync(path, 'utf8');

        let password;
        if (typeof process.env.PK_PASSWORD !== 'string') {

            // TODO suppress echo
            password = await questionAsync('Enter password to decrypt private key: ', true);
        } else {
            password = process.env.PK_PASSWORD.trim();
        }

        return decryptPkFileContent(Crypto, encodedContent, password);
    },

    createObjInvocationCode(strMethod, arrArguments) {
        return {
            method: strMethod,
            arrArguments
        };
    },

    decryptPkFileContent,
    mapEnvToOptions,
    mapOptionsToNodeParameters,
    GCD,
    createPeerTag,
    finePrintUtxos,
    getBoolEnvParameter,
    ExceptionDebug,
    ExceptionLog
};
