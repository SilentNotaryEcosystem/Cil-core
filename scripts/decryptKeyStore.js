const fs = require('fs');
const path = require('path');

const factory = require('../factory');
const {questionAsync, readPrivateKeyFromFile} = require('../utils');

;(async () => {
    await factory.asyncLoad();

    const filename = await questionAsync('Enter filename with old PK: ');
    try {
        const pk = await readPrivateKeyFromFile(factory.Crypto, path.resolve('../' + filename));
        console.log(`Private key is: ${pk}`);
        console.error('Password is ok!');
    } catch (e) {
        console.error('Wrong password');
    }

})().then(() => {
    process.exit(0);
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
