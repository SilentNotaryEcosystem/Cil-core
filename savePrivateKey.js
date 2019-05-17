const fs = require('fs');

const factory = require('./factory');
const {questionAsync} = require('./utils');

;(async () => {
    await factory.asyncLoad();

    const pk = await questionAsync('Enter private key: ');

    // TODO suppress echo
    const password = await questionAsync('Enter password: ');
    const passwordCheck = await questionAsync('Repeat password: ');
    if (password !== passwordCheck) throw('Passwords are not same!');

    const filename = await questionAsync('Enter filename: ');

    const encryptedPk = await factory.Crypto.encrypt(password, Buffer.from(pk, 'hex'));
    fs.writeFileSync(filename, encryptedPk.toString('hex'));

})().then(() => {
    console.log('Done');
    process.exit(0);
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
