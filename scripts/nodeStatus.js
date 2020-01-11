const http = require('http');

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
    const arrResult = await requestTips();
    const objMostRecentTipHeader = arrResult.reduce((objLastBlockHeader, {block}) =>
        !objLastBlockHeader || (objLastBlockHeader && objLastBlockHeader.timestamp < block.header.timestamp) ?
            block.header : objLastBlockHeader, undefined);

    const nSecDiff = parseInt(Date.now() / 1000) - objMostRecentTipHeader.timestamp;
    console.log(`Last block received ${nSecDiff} seconds ago.`);

    const strStatus = nSecDiff < 600 ? 'Alive' : 'Syncing (or dead)';
    console.log(`Status: ${strStatus}`);
}

async function requestTips() {
    const options = {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        }
    };

    const chunks = [];
    const {result} = await new Promise((resolve, reject) => {
        const req = http.request(urlRpc, options, res => {
            res.on("data", (chunk) => {
                chunks.push(chunk);
            });

            res.on("end", () => {
                const buffBody = Buffer.concat(chunks);
                resolve(JSON.parse(buffBody.toString()));
            });

            req.on('error', (e) => {
                reject(e);
            });
        });

        req.write(JSON.stringify({jsonrpc: '2.0', method: 'getTips', params: [], id: 67}));
        req.end();
    });

    return result;
}

