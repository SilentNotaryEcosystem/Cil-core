const factory = require('./factory');

const {
    readCmdLineOptions,
    sleep,
    stripAddressPrefix,
    readPrivateKeyFromFile,
    mapEnvToOptions,
    mapOptionsToNodeParameters
} = require('./utils');

process.on('warning', e => console.warn(e.stack));

(async () => {
    await factory.asyncLoad();

    console.log(`Using ${factory.Constants.strIdent} config`);

    // Read user-defined parameters
    const objUserParams = {
        // read ENV options
        ...mapEnvToOptions(),

        // read command line options (have precedence over ENV)
        ...readCmdLineOptions()
    };

    // override global parameters
    if (objUserParams.genesisHash) factory.Constants.GENESIS_BLOCK = objUserParams.genesisHash;
    if (objUserParams.conciliumDefContract) {
        factory.Constants.CONCILIUM_DEFINITION_CONTRACT_ADDRESS = objUserParams.conciliumDefContract;
    }

    let commonOptions = {
        ...mapOptionsToNodeParameters(objUserParams),
        ...setImpliedParameters(objUserParams)
    };

    // if there are wallet tasks - program will terminate after completion!
    await walletTasks(commonOptions);

    // if there is rebuild task - program will terminate after completion!
    await rebuildDb(commonOptions);

    // this will completely erase DB, and resync it from neighbors
    await clearDb(commonOptions);

    let node;
    if (objUserParams.privateKey) {
        const decryptedPk = await readPrivateKeyFromFile(factory.Crypto, objUserParams.privateKey);
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
    });

async function rebuildDb(objCmdLineParams) {
    const {rebuildDb} = objCmdLineParams;
    if (!rebuildDb) return;

    try {
        const storage = new factory.Storage({...objCmdLineParams, mutex: new factory.Mutex()});
        await storage.dropAllForReIndex();

        const node = new factory.Node({...objCmdLineParams, workerSuspended: true, networkSuspended: true});
        await node.ensureLoaded();
        await node.rebuildDb();
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

async function clearDb(objCmdLineParams) {
    try {
        const storage = new factory.Storage({...objCmdLineParams, mutex: new factory.Mutex()});
//        if (await storage.hasBlock('5cd32a04238a61a29d95ed48ce6b08ba2973b6fb0858446b76bb20c93e5492b4')) {
        await storage.dropAllForReIndex(true);
//        }
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

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
        const arrAddresses = await storage.getWalletsAddresses();
        if (!arrAddresses.length) {
            console.log('No addresses found in wallet');
        } else {
            console.log('Addresses found in wallets');
            console.dir(await storage.getWalletsAddresses(), {colors: true, depth: null});
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

/**
 * Let user skip some parameters.
 * I.e. if he set rpcUser, we think he wants RPC, but RPC will be started only if rpcAddress present. So let's set it
 *
 * @param {Object} objUserParams
 */
function setImpliedParameters(objUserParams) {
    let objAddOn = {};
    if (objUserParams.localDevNode) {
        objAddOn = {
            ...objAddOn,
            arrDnsSeeds: ['non-existed.cil'],
            listenPort: 28223,
            arrSeedAddresses: ['1.1.1.1']
        };
    }

    if (objUserParams.rpcUser) {
        objAddOn = {
            ...objAddOn,
            rpcAddress: '0.0.0.0'
        };
    }

    if (objUserParams.reIndexWallet || objUserParams.watchAddress) {
        objAddOn = {
            ...objAddOn,
            walletSupport: true
        };
    }

    return objAddOn;
}
