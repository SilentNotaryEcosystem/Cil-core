'use strict';

// Should not allow execute any dangerous or nondeterministic operation in a smart contract
module.exports = [
    'require(',
    'eval(',
    'Math.random(',
    'setTimeout(',
    'clearTimeout(',
    'setImmediate(',
    'clearImmediate(',
    'setInterval(',
    'clearInterval(',
    'console.',
    'process.'
];
