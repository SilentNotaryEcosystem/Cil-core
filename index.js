const factory = require('./factory');
const config = require('./config/prod.conf');

(async () => {
    await factory.asyncLoad();

    const commonOptions = {
        listenAddr: config.listenAddress,
        arrSeedAddresses: config.listenAddress ? [config.listenAddress] : []
    };

    let node;
    if (config.privateKey) {
        const witnessWallet = new factory.Wallet(config.privateKey);
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

    // process will remain active since node will start RPC server
})()
    .catch(err => console.error(err));
