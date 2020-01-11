const {queryRpc} = require('../utils');

let urlRpc;
if (process.env.NODE_ENV === 'Devel') {
    urlRpc = 'http://localhost:18222';
} else {
    urlRpc = 'http://localhost:8222';
}

main()
    .then(_ => {
        process.exit(0);
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });

async function main() {
    const arrResult = await queryRpc(urlRpc, 'getTips');
    const objMostRecentTipHeader = arrResult.reduce((objLastBlockHeader, {block}) =>
        !objLastBlockHeader || (objLastBlockHeader && objLastBlockHeader.timestamp < block.header.timestamp) ?
            block.header : objLastBlockHeader, undefined);

    const nSecDiff = parseInt(Date.now() / 1000) - objMostRecentTipHeader.timestamp;
    console.log(`Last block received ${nSecDiff} seconds ago.`);

    const strStatus = nSecDiff < 600 ? 'Alive' : 'Syncing (or DEAD)';
    console.log(`Status: ${strStatus}`);
}


