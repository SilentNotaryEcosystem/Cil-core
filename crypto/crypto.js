//should be used for encryption more resistant to brute force
//const argon2 = require('argon2');
//const {argon2d} = argon2
const crypto = require('crypto');
const createHash = crypto.createHash;
const EC = require('elliptic').ec;

const ec = new EC('secp256k1');

/**
 * Wrapper for keypair, to easy replace it without renaming methods
 * Just redefine getPrivate & getPublic
 */
class KeyPair {
    constructor(keyPair) {
        this._pair = keyPair;
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
}

// algorithm used to symmtrical encryption/decryption (for storing privateKeys)
const ALGO = 'aes256';
const LENGTH = 16;

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
        return new KeyPair(ec.keyPair({ priv: privateKey, privEnc: enc }));
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
    static sign(msg, key, enc, options) {
        return Buffer.from(ec.sign(msg, key, enc, options).toDER());
    }

    /**
     * Sign transaction with r, s, v
     * @param {Buffer} msg
     * @param {BN|String} key - private key (BN - BigNumber @see https://github.com/indutny/bn.js)
     * @param {String} enc - encoding of private key. possible value = 'hex', else it's trated as Buffer
     * @param {Object} options - for hmac-drbg
     * @return {Object}
     */
    static signTransaction(msg, key, enc, options) {
        let sign = ec.sign(msg, key, enc, options);
        let ret = {};
        ret.r = sign.r;
        ret.s = sign.s;
        ret.v = sign.recoveryParam + 27;
        return ret;
    }

    /**
     *  Get public key fromm signature
     * @param {Buffer} msg 
     * @param {Object} signature 
     * @param {Number} j 
     * @param {Object} enc 
     */
    static getPublicKey(msg, signature, j, enc) {
        return ec.recoverPubKey(msg, signature, j, enc);
    }

    /**
     *
     * @param {Buffer} msg
     * @param {Buffer} signature
     * @param {Point|String} key - public key (depends on encoding)
     * @param {String} enc - encoding of private key. possible value = 'hex', else it's treated as Buffer
     * @return {boolean}
     */
    static verify(msg, signature, key, enc) {
        return ec.verify(msg, signature, key, enc);
    }

    /**
     *
     * @param {String} strPublicKey - transform if needed as kyePair.getPublic(true, 'hex')
     * @return {*}
     */
    static getAddress(strPublicKey) {
        return this.hash160(strPublicKey);
    }

    static ripemd160(buffer) {
        return createHash('rmd160').update(buffer).digest().toString('hex');
    }

    static sha1(buffer) {
        return createHash('sha1').update(buffer).digest().toString('hex');
    }

    static sha256(buffer) {
        return createHash('sha256').update(buffer).digest().toString('hex');
    }

    static hash160(buffer) {
        return this.ripemd160(this.sha256(buffer));
    }

    static hash256(buffer) {
        return this.sha256(this.sha256(buffer));
    }

    /**
     * Used to stored privateKey
     *
     * @param {String} password - plain text (utf8) secret
     * @param {Buffer|String} buffer - base64 string or buffer to decrypt
     * @return {Buffer} - decrypted key
     */
    static async decrypt(password, buffer) {
        const key = Buffer.from(this.sha256(password), 'hex');
        //        const key=await argon2.hash(password, {type: argon2d, raw: true, salt: Buffer.alloc(16, 'salt')});
        const ivEnc = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'base64');
        const iv = ivEnc.slice(0, LENGTH);
        const enc = ivEnc.slice(LENGTH);
        const decipher = crypto.createDecipheriv(ALGO, key, iv);
        try {
            return Buffer.concat([decipher.update(enc), decipher.final()]);
        } catch (err) {
            return undefined;
        }
    }

    /**
     * Used to decrypt stored privateKey
     *
     * @param {String} password - utf8 encoded
     * @param {Buffer} buffer - buffer to encode
     * @return {Buffer} encrypted buffer
     */
    static async encrypt(password, buffer) {
        const key = Buffer.from(this.sha256(password), 'hex');
        //        const key=await argon2.hash(password, {type: argon2d, raw: true, salt: Buffer.alloc(16, 'salt')});
        const iv = this.randomBytes(LENGTH);
        const cipher = crypto.createCipheriv(ALGO, key, iv);
        const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
        const ivEnc = Buffer.concat([iv, enc], iv.length + enc.length);
        return ivEnc;
    }

    static randomBytes(length) {
        return crypto.randomBytes(length);
    }
}

module.exports = CryptoLib;
