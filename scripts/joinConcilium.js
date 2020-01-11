const url = require('url');

const factory = require('../factory');
const {questionAsync, readPrivateKeyFromFile, prepareForStringifyObject, queryRpc, getHttpData} = require('../utils');

let urlApi;
let urlRpc;
if (process.env.NODE_ENV === 'Devel') {
    urlApi = 'https://test-explorer.ubikiri.com/api/';
    urlRpc = 'http://localhost:18222';
} else {
    urlApi = 'https://explorer.ubikiri.com/api/';
    urlRpc = 'http://localhost:8222';
}

const nConciliumId = process.env.CONCILIUM_ID ? parseInt(process.env.CONCILIUM_ID) : 1;
const nMinAmount = process.env.MIN_AMOUNT ? parseFloat(process.env.MIN_AMOUNT) : 1e8;

main()
    .then(_ => {
        process.exit(0);
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });

async function main() {
    const privateKey = await readPrivateKeyFromFile(factory.Crypto, './private');
    const wallet = new factory.Wallet(privateKey);

    const amount = parseFloat(await questionAsync(`Enter amount to deposit (minimum ${nMinAmount} coins):`));
    if (amount < nMinAmount) {
        throw new Error(`You want to deposit (${amount} coins). It's less than minumum (${nMinAmount})`);
    }

    const fees = 4e4;
    const arrUtxos = await getUtxos(wallet.address);
    const {arrCoins} = gatherInputsForAmount(arrUtxos, amount + fees);

    const tx = joinConcilium(nConciliumId, amount, wallet, arrCoins);
    console.error(
        `Here is TX containment: ${JSON.stringify(prepareForStringifyObject(tx.rawData), undefined, 2)}`);
    console.log(`Tx hash ${tx.getHash()}`);
//    console.log(tx.encode().toString('hex'));
    await sendTx(tx.encode().toString('hex'));
}

/**
 *
 * @param {Number} conciliumId
 * @param {Number} amount
 * @param {Wallet} wallet
 * @param {Array} arrUtxos - [{"hash", "nOut", "amount","isStable"}]
 * @returns {*}
 */

function joinConcilium(conciliumId, amount, wallet, arrUtxos) {
    const contractCode = {
        method: 'joinConcilium',
        arrArguments: [conciliumId]
    };

    const tx = factory.Transaction.invokeContract(
        factory.Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS,
        contractCode,
        amount,
        wallet.address
    );

    for (let utxo of arrUtxos) {
        console.log(`Using UTXo ${utxo.hash} idx ${utxo.nOut}`);
        tx.addInput(utxo.hash, utxo.nOut);
    }
    for (let i in arrUtxos) {
        tx.claim(parseInt(i), wallet.privateKey);
    }

    tx.signForContract(wallet.privateKey);

    return tx;
}

async function getUtxos(strAddress) {
    return await queryApi('Unspent', strAddress);
}

async function queryApi(endpoint, strParam) {
    const result = await getHttpData(url.resolve(urlApi, `${endpoint}/${strParam}`));
    return result;
}

async function sendTx(strTx) {
    return queryRpc(urlRpc, 'sendRawTx', {strTx});
}

/**
 *
 * @param {Array} arrUtxos of {hash, nOut, amount}
 * @param {Number} amount TO SEND (not including fees)
 * @return {arrCoins, gathered}
 */
function gatherInputsForAmount(arrUtxos, amount) {
    const nFeePerInput = factory.Constants.fees.TX_FEE * 0.12;
    const arrCoins = [];
    let gathered = 0;
    for (let coins of arrUtxos) {
        if (!coins.amount) continue;
        gathered += coins.amount;
        arrCoins.push(coins);
        if (gathered > amount + nFeePerInput * arrCoins.length) return {arrCoins, gathered};
    }
    throw new Error('Not enough coins!');
}


