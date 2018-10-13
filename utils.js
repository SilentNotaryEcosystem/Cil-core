const arrayIntersection = (array1, array2) => {
    const cache = new Set();
    const result = [];
    for (let elem of array1) cache.add(elem);
    for (let elem of array2) if (cache.has(elem)) result.push(elem);
    return result;
};

module.exports = {
    sleep: (delay) => {
        return new Promise(resolve => {
            setTimeout(() => resolve(), delay);
        });
    },
    arrayIntersection,

    // order is not guaranteed! only equality of content
    arrayEquals: (array1, array2) => {
        return array1.length === array2.length && arrayIntersection(array1, array2).length === array1.length;
    }
};
