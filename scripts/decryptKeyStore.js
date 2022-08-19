const path = require('path');

const factory = require('../factory');
const {questionAsync, readPrivateKeyFromFile} = require('../utils');

(async () => {
    await factory.asyncLoad();

    const filename = await questionAsync('Enter filename with PK: ');
    try {
        const pk = await readPrivateKeyFromFile(factory.Crypto, path.resolve('../' + filename));
        const kp = factory.Crypto.keyPairFromPrivate(pk);
        console.log(`Private key is: ${pk}`);
        console.log(`Address is: ${kp.address}`);
        console.error('Password is ok!');
    } catch (e) {
        console.error(e);
    }
})()
    .then(() => {
        process.exit(0);
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
