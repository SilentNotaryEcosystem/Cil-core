const factory = require('./factory');
const config = require('./config/prod.conf');

const {readCmdLineOptions} = require('./utils');

(async () => {
    await factory.asyncLoad();

    // read command line options
    const objCmdLineParams = readCmdLineOptions();
    const commonOptions = {

        // if command line parameter have same name as option name, like "rpcUser"
        ...objCmdLineParams,

        // non matching names
        listenPort: objCmdLineParams.port,
        arrSeedAddresses: objCmdLineParams.seedAddr ? [objCmdLineParams.seedAddr] : []
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

    await node.bootstrap();

    // it's a witness node
    if (typeof node.start === 'function') {

        // if it returns false, than we still have no definition for our witness,
        // possibly it's because we haven't loaded respective block. let's loop until we got it
        while (!await node.start()) await sleep(1000);
    }

})()
    .catch(err => console.error(err));
