//should be used for encryption more resistant to brute force
//const argon2 = require('argon2');
//const {argon2d} = argon2
const crypto = require('crypto');
const createHash = crypto.createHash;
const elliptic = require('elliptic');
const EC = elliptic.ec;
const sha3 = require('js-sha3');
const BN = require('bn.js');

const ec = new EC('secp256k1');

/**
 * Wrapper for keypair, to easy replace it without renaming methods
 * Just redefine getPrivate & getPublic
 */
class KeyPair {
    constructor(keyPair) {
        this._pair = keyPair;
    }

    get address() {
        return this.getAddress(false);
    }

    get privateKey() {
        return this.getPrivate();
    }

    get publicKey() {
        return this.getPublic();
    }

    /**
     * if you need point - pass false to encoding
     *
     * @param {String | *} encoding
     * @return {*}
     */
    getPrivate(encoding = 'hex') {
        return this._pair.getPrivate(encoding);
    }

    /**
     * if you need point - pass false to encoding
     *
     * @param {Boolean} compact
     * @param {String | *} encoding
     * @return {*}
     */
    getPublic(compact = true, encoding = 'hex') {
        return this._pair.getPublic(compact, encoding);
    }

    /**
     *
     * @param {Boolean} needBuffer
     * @returns {String|Buffer}
     */
    getAddress(needBuffer = true) {
        return CryptoLib.getAddress(this.getPublic(), needBuffer);
    }

}

// algorithm used to symmtrical encryption/decryption (for storing privateKeys)
const ALGO = 'aes256';
const LENGTH = 16;
const SCRYPT_OPTIONS = {N: 262144, p: 1, r: 8};
const PBKDF2_OPTIONS = {iterations: 1e5};

class CryptoLib {

    /**
     *
     * @return {KeyPair}
     */
    static createKeyPair() {
        return new KeyPair(ec.genKeyPair());
    }

    /**
     *
     * @return {KeyPair}
     */
    static keyPairFromPrivate(privateKey, enc = 'hex') {
        return new KeyPair(ec.keyPair({priv: privateKey, privEnc: enc}));
    }

    /**
     *
     * @return {KeyPair}
     */
    static keyPairFromPublic(publicKey, enc = 'hex') {
        return new KeyPair(ec.keyFromPublic(publicKey, enc));
    }

    /**
     *
     * @param {Buffer} msg
     * @param {BN|String} key - private key (BN - BigNumber @see https://github.com/indutny/bn.js)
     * @param {String} enc - encoding of private key. possible value = 'hex', else it's trated as Buffer
     * @param {Object} options - for hmac-drbg
     * @return {Buffer}
     */
    static sign(msg, key, enc = 'hex', options) {
        if (!key) throw new Error('Bad private key!');
        const sig = ec.sign(msg, key, enc, options);
        return this.signatureToBuffer(sig);
    }

    /**
     *
     * @param {Object} signature
     * @param {BN} signature.r
     * @param {BN} signature.s
     * @param {Number} signature.recoveryParam
     * @return {Buffer}
     */
    static signatureToBuffer(signature) {
        if (!signature || !signature.r || !signature.s || signature.recoveryParam === undefined) {
            throw new Error('Bad signature!');
        }
        const buffR = Buffer.from(signature.r.toArray('bn', 32));
        const buffS = Buffer.from(signature.s.toArray('bn', 32));
        return Buffer.concat([buffR, buffS, Buffer.from([signature.recoveryParam])]);
    }

    /**
     *
     * @param {Buffer} buff
     * @return {Object} {r,s, recoveryParam}
     */
    static signatureFromBuffer(buff) {
        if (buff.length !== 65) throw new Error(`Wrong signature length: ${buff.length}`);
        const buffR = buff.slice(0, 32);
        const buffS = buff.slice(32, 64);
        const buffRecovery = buff.slice(64, 65);
        return {
            r: new BN(buffR.toString('hex'), 16, 'be'),
            s: new BN(buffS.toString('hex'), 16, 'be'),
            recoveryParam: buffRecovery[0]
        };
    }

    /**
     *
     * @param {Buffer} msg
     * @return {String}
     */
    static createHash(msg) {
        return this.sha3(msg);
    }

    /**
     * Same as above, but returns Buffer
     *
     * @param {Buffer} msg
     * @return {Buffer}
     */
    static createHashBuffer(msg) {
        return Buffer.from(this.createHash(msg), 'hex');
    }

    /**
     * Get public key from signature
     * ATTENTION! due "new BN(msg)" (@see below) msg.length should be less than 256bit!!
     * So it's advisable to sign hashes!
     *
     * @param {Buffer} msg
     * @param {Object | Buffer} signature @see elliptic/ec/signature
     * @return {String} compact public key
     */
    static recoverPubKey(msg, signature) {
        const sig = Buffer.isBuffer(signature) ? this.signatureFromBuffer(signature) : signature;

        // @see node_modules/elliptic/lib/elliptic/ec/index.js:198
        // "new BN(msg);" - no base used, so we convert it to dec
        const hexToDecimal = (x) => ec.keyFromPrivate(x, 'hex').getPrivate().toString(10);

        // ec.recoverPubKey returns Point. encode('hex', true) will convert it to hex string compact key
        // @see node_modules/elliptic/lib/elliptic/curve/base.js:302 BasePoint.prototype.encode
        return ec.recoverPubKey(hexToDecimal(msg), sig, sig.recoveryParam).encode('hex', true);
    }

    /**
     *
     * @param {Buffer} msg
     * @param {Buffer} signature
     * @param {Point|String} key - public key (depends on encoding)
     * @param {String} enc - encoding of private key. possible value = 'hex', else it's treated as Buffer
     * @return {boolean}
     */
    static verify(msg, signature, key, enc = 'hex') {
        return ec.verify(msg, this.signatureFromBuffer(signature), key, enc);
    }

    /**
     *
     * @param {String} publicKey - transform if needed as kyePair.getPublic(true, 'hex')
     * @param {Boolean} needBuffer - do we need address as Buffer or as String
     * @return {String | Buffer}
     */
    static getAddress(publicKey, needBuffer = false) {
        return needBuffer ? Buffer.from(this.hash160(publicKey), 'hex') : this.hash160(publicKey);
    }

    /**
     * WARNING! Modify here! if change address to something different than 160 bit (hash160)
     * @return {Buffer}
     */
    static getAddrContractCreation() {
        return Buffer.alloc(20, 0);
    }

    static ripemd160(buffer) {
        return createHash('rmd160').update(buffer).digest().toString('hex');
    }

    static hash160(buffer) {
        return this.ripemd160(this.createHash(buffer));
    }

    /**
     *
     * @param {String} password
     * @param {Buffer} salt - use randombytes! to generate it!
     * @param {Number} hashLength - in BYTES!
     * @returns {Buffer}
     */
    static argon2(password, salt, hashLength = 32) {
        // raw: true - mandatory!
//        const key = await argon2.hash(password, {salt, type: argon2id, raw: true, hashLength});
        throw new Error('Not implemented yet');
    }

    /**
     *
     * @param {String} password
     * @param {Buffer} salt - use randombytes! to generate it!
     * @param {Number} hashLength - in BYTES!
     * @param {Options} options - @see https://nodejs.org/api/crypto.html#crypto_crypto_scryptsync_password_salt_keylen_options
     * @returns {Buffer}
     */
    static scrypt(password, salt, hashLength = 32, options) {
        return crypto.scryptSync(password, salt, hashLength, options);
    }

    static pbkdf2(password, salt, hashLength = 32, hashOptions) {
        const {iterations} = hashOptions;
        return crypto.pbkdf2Sync(password, salt, iterations, hashLength, 'sha1');
    }

    /**
     *
     * @param {Buffer} buffer
     * @param {Number} length acceptably 224 | 256 | 384 | 512
     * @return {String} hex string!!
     */
    static sha3(buffer, length = 256) {
        switch (length) {
            case 224:
                return sha3.sha3_224(buffer);
            case 256:
                return sha3.sha3_256(buffer);
            case 384:
                return sha3.sha3_384(buffer);
            case 512:
                return sha3.sha3_512(buffer);
            default:
                return sha3.sha3_256(buffer);
        }
    }

    static createKey(passwordHashFunction, password, salt, hashOptions) {
        let key;
        let options;
        switch (passwordHashFunction) {
            case 'sha3':
                key = this.sha3(password, 256);
                break;
            case 'pbkdf2':
                options = hashOptions || PBKDF2_OPTIONS;
                key = this.pbkdf2(password, salt, 32, options);
                break;
            case 'argon2':
                key = this.argon2(password, salt, 32);
                break;
            case 'scrypt':
                options = {...SCRYPT_OPTIONS, ...hashOptions};
                options.maxmem = 129 * options.N * options.r;
                key = this.scrypt(
                    password,
                    salt,
                    32,
                    options
                );
                break;
            default:
                throw new Error(`Hash function ${passwordHashFunction} is unknown`);
                break;
        }
        return {key: Buffer.from(key, 'hex'), options};
    }

    /**
     * Used to stored privateKey
     *
     * @param {String} password - plain text (utf8) secret
     * @param {Object} objEncryptedData - {iv, encrypted, salt, hashOptions, keyAlgo}
     * @return {Buffer} - decrypted key
     */
    static decrypt(password, objEncryptedData) {
        let {iv, encrypted, salt, hashOptions, keyAlgo} = objEncryptedData;
        iv = Buffer.from(iv, 'hex');
        encrypted = Buffer.from(encrypted, 'hex');
        salt = !salt || Buffer.from(salt, 'hex');

        const {key} = this.createKey(
            keyAlgo,
            password,
            salt,
            hashOptions
        );

        const decipher = crypto.createDecipheriv(ALGO, key, iv);
        try {
            if (!(encrypted.length % 32)) decipher.setAutoPadding(false);
            return Buffer.concat([decipher.update(encrypted), decipher.final()]);
        } catch (err) {
            return undefined;
        }
    }

    /**
     * Used to decrypt stored privateKey
     *
     *
     * @param {String} password - utf8 encoded
     * @param {Buffer} buffer - buffer to encode
     * @param {String} keyAlgo - @see this.createKey
     * @return {Object}
     */
    static async encrypt(password, buffer, keyAlgo = 'scrypt') {

        // generate salt for 'scrypt' & 'argon2'
        const salt = this.randomBytes(LENGTH);

        const {key, options: hashOptions} = this.createKey(keyAlgo, password, salt);
        const iv = this.randomBytes(LENGTH);
        const cipher = crypto.createCipheriv(ALGO, key, iv);
        if (!(buffer.length % 32)) cipher.setAutoPadding(false);
        const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);

        return {
            iv,
            encrypted: enc,
            salt,
            hashOptions,
            keyAlgo
        };
    }

    static randomBytes(length) {
        return crypto.randomBytes(length);
    }
}

module.exports = CryptoLib;
