const fs = require('fs');

const factory = require('./factory');
const {questionAsync, prepareForStringifyObject} = require('./utils');

;(async () => {
    await factory.asyncLoad();

    const pk = await questionAsync('Enter private key: ');

    // TODO suppress echo
    const password = await questionAsync('Enter password: ');
    const passwordCheck = await questionAsync('Repeat password: ');
    if (password !== passwordCheck) throw('Passwords are not same!');

    const filename = await questionAsync('Enter filename: ');
    const keyGenFunction = await questionAsync(
        'Enter key generation mechanism (avail: "sha3", "scrypt". default: "scrypt"): ');

    const objEncryptedPk = await factory.Crypto.encrypt(
        password,
        Buffer.from(pk, 'hex'), {
            keyAlgo: keyGenFunction === '' ? "scrypt" : keyGenFunction
        }
    );
    fs.writeFileSync(filename, JSON.stringify({
        ...prepareForStringifyObject(objEncryptedPk),
        version: 1
    }));

})().then(() => {
    console.log('Done');
    process.exit(0);
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
