const commandLineArgs = require('command-line-args');

const arrayIntersection = (array1, array2) => {
    const cache = new Set();
    const result = [];
    for (let elem of array1) cache.add(elem);
    for (let elem of array2) if (cache.has(elem)) result.push(elem);
    return result;
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
        const arrSet1 = Array.from(set1.values());
        const arrSet2 = Array.from(set2.values());
        return new Set(arrSet1.concat(arrSet2));
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
    }
};
