const factory = require('./factory');

const {readCmdLineOptions, sleep} = require('./utils');

process.on('warning', e => console.warn(e.stack));

(async () => {
    await factory.asyncLoad();

    console.log(`Using ${factory.Constants.strIdent} config`);

    // read command line options
    const objCmdLineParams = readCmdLineOptions();

    // just add wallet address and EXIT!
    if (objCmdLineParams.reIndexWallet || objCmdLineParams.watchAddress && objCmdLineParams.watchAddress.length) {
        const storage = new factory.Storage({
            walletSupport: true,
            mutex: new factory.Mutex(),
            ...objCmdLineParams
        });

        if (objCmdLineParams.watchAddress) {
            for (let addr of objCmdLineParams.watchAddress) {
                await storage.walletWatchAddress(addr);
            }
        }

        if (objCmdLineParams.reIndexWallet) await storage.walletReIndex();
        return;
    }

    if (objCmdLineParams.genesisHash) factory.Constants.GENESIS_BLOCK = objCmdLineParams.genesisHash;
    if (objCmdLineParams.groupDefContract) {
        factory.Constants.GROUP_DEFINITION_CONTRACT_ADDRESS = objCmdLineParams.groupDefContract;
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
        const witnessWallet = new factory.Wallet(objCmdLineParams.privateKey);
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
    .catch(err => console.error(err));
