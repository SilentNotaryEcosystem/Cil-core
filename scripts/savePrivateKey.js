const fs = require('fs');

const factory = require('../factory');
const {questionAsync, prepareForStringifyObject} = require('../utils');

;(async () => {
    await factory.asyncLoad();

    const pk = await questionAsync('Enter private key: ');

    // TODO suppress echo
    const password = await questionAsync('Enter password: ');
    const passwordCheck = await questionAsync('Repeat password: ');
    if (password !== passwordCheck) throw('Passwords are not same!');

    const filename = await questionAsync('Enter filename (empty for docker): ');
    const keyGenFunction = await questionAsync(
        'Enter key generation mechanism (avail: "pbkdf2", "scrypt". default: "scrypt"): ');

    const objEncryptedPk = await factory.Crypto.encrypt(
        password,
        Buffer.from(pk, 'hex'),
        keyGenFunction === '' ? "scrypt" : keyGenFunction
    );

    const kp = factory.Crypto.keyPairFromPrivate(pk);

    const objKeyFileContent = JSON.stringify({
        address: 'Ux' + kp.address,
        ...prepareForStringifyObject(objEncryptedPk),
        version: 1.1
    });

    console.error(objKeyFileContent);
    if (filename && filename.length) fs.writeFileSync(filename, objKeyFileContent);

})().then(() => {
    process.exit(0);
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
