const factory = require('./factory');

const {readCmdLineOptions, sleep, stripAddressPrefix, readPrivateKeyFromFile} = require('./utils');

process.on('warning', e => console.warn(e.stack));

(async () => {
    await factory.asyncLoad();

    console.log(`Using ${factory.Constants.strIdent} config`);

    // read command line options
    const objCmdLineParams = readCmdLineOptions();

    // wallets tasks will exit after completion!
    await walletTasks(objCmdLineParams);

    if (objCmdLineParams.genesisHash) factory.Constants.GENESIS_BLOCK = objCmdLineParams.genesisHash;
    if (objCmdLineParams.conciliumDefContract) {
        factory.Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS = objCmdLineParams.conciliumDefContract;
    }

    const commonOptions = {

        // if command line parameter have same name as option name, like "rpcUser"
        ...objCmdLineParams,

        // non matching names
        buildTxIndex: objCmdLineParams.txIndex,
        listenPort: objCmdLineParams.port,
        arrSeedAddresses: objCmdLineParams.seedAddr ? [objCmdLineParams.seedAddr] : [],
        isSeed: objCmdLineParams.seed
    };

    let node;
    if (objCmdLineParams.privateKey) {
        const decryptedPk = await readPrivateKeyFromFile(factory.Crypto, objCmdLineParams.privateKey);
        if (!decryptedPk) throw new Error('failed to decrypt file with private key');
        const witnessWallet = new factory.Wallet(decryptedPk);
        node = new factory.Witness({
            ...commonOptions,
            wallet: witnessWallet
        });
    } else {
        node = new factory.Node({
            ...commonOptions
        });
    }

    process.on('SIGINT', node.gracefulShutdown.bind(node));
    process.on('SIGTERM', node.gracefulShutdown.bind(node));

    await node.ensureLoaded();
    await node.bootstrap();

    // it's a witness node
    if (typeof node.start === 'function') {

        // if it returns false, than we still have no definition for our witness,
        // possibly it's because we haven't loaded respective block. let's loop until we got it
        while (!await node.start()) await sleep(1000);
    }

})()
    .catch(err => {
        console.error(err);
        process.exit(1);
    });

async function walletTasks(objCmdLineParams) {
    const {listWallets, reIndexWallet, watchAddress} = objCmdLineParams;
    if (!(listWallets || reIndexWallet || watchAddress)) return;

    const storage = new factory.Storage({
        walletSupport: true,
        mutex: new factory.Mutex(),
        ...objCmdLineParams
    });

    // add new wallets
    if (watchAddress && watchAddress.length) await taskWatchWallets(storage, watchAddress);

    // reindex
    if (reIndexWallet) await taskReindexWallets(storage);

    // list
    if (listWallets) await taskListWallets(storage);

    process.exit(0);

    // -----------------------------
    async function taskListWallets(storage) {
        const arrAddresses = await storage.getWallets();
        if (!arrAddresses.length) {
            console.log('No addresses found in wallet');
        } else {
            console.log('Addresses found in wallets');
            console.dir(await storage.getWallets(), {colors: true, depth: null});
        }
    }

    async function taskReindexWallets(storage) {
        await storage.walletReIndex();
    }

    async function taskWatchWallets(storage, arrWatchAddresses) {
        for (let addr of arrWatchAddresses) {
            await storage.walletWatchAddress(stripAddressPrefix(factory.Constants, addr));
        }
    }
}

