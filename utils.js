const commandLineArgs = require('command-line-args');

const arrayIntersection = (array1, array2) => {
    const cache = new Set(array1);
    const result = [];
    for (let elem of array2) if (cache.has(elem)) result.push(elem);
    return result;
};

const prepareForStringifyObject = (obj) => {
    if (!(obj instanceof Object)) return obj;

    if (Buffer.isBuffer(obj)) return obj.toString('hex');
    if (Array.isArray(obj)) return obj.map(elem => prepareForStringifyObject(elem));

    const resultObject = {};
    for (let key of Object.keys(obj)) {
        if (typeof obj[key] === 'function') continue;
        if (Buffer.isBuffer(obj[key])) {
            resultObject[key] = obj[key].toString('hex');
        } else if (Array.isArray(obj[key])) {
            resultObject[key] = prepareForStringifyObject(obj[key]);
        } else if (obj[key] instanceof Object) {
            resultObject[key] = prepareForStringifyObject(obj[key]);
        } else {
            resultObject[key] = obj[key];
        }
    }
    return resultObject;
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
            {name: "listenAddr", type: String, multiple: false},
            {name: "port", type: Number, multiple: false},
            {name: "seedAddr", type: String, multiple: false},
            {name: "rpcUser", type: String, multiple: false},
            {name: "rpcPass", type: String, multiple: false},
            {name: "rpcPort", type: Number, multiple: false},
            {name: "rpcAddress", type: String, multiple: false},
            {name: "genesisHash", type: String, multiple: false},
            {name: "groupDefContract", type: String, multiple: false},
            {name: "privateKey", type: String, multiple: false},
            {name: "dbPath", type: String, multiple: false},
            {name: "seed", type: Boolean, multiple: false},
            {name: "strictAddresses", type: Boolean, multiple: false}
        ];
        return commandLineArgs(optionDefinitions, {camelCase: true});
    },

    prepareForStringifyObject
};
