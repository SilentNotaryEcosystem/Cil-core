const createHash = require('crypto').createHash;
const EC =require('elliptic').ec;

const ec = new EC('secp256k1');

class CryptoLib{

    /**
     *
     * @return {KeyPair}
     */
    static createKeyPair(){
        return ec.genKeyPair();
    }

    /**
     *
     * @return {KeyPair}
     */
    static keyPairFromPrivate(privateKey, enc){
        return ec.keyPair({priv: privateKey, privEnc: enc});
    }

    /**
     *
     * @param {Buffer} msg
     * @param {BN|String} key - private key (BN - BigNumber @see https://github.com/indutny/bn.js)
     * @param {String} enc - encoding of private key. possible value = 'hex', else it's trated as Buffer
     * @param {Object} options - for hmac-drbg
     * @return {Buffer}
     */
    static sign(msg, key, enc, options){
        return Buffer.from(ec.sign(msg, key, enc, options).toDER());
    }

    /**
     *
     * @param {Buffer} msg
     * @param {Buffer} signature
     * @param {Point|String} key - public key
     * @param {String} enc - encoding of private key. possible value = 'hex', else it's trated as Buffer
     * @return {boolean}
     */
    static verify(msg, signature, key, enc){
        return ec.verify(msg, signature, key, enc);
    }

    /**
     *
     * @param {String} strPublicKey - transform if needed as kyePair.getPublic(true, 'hex')
     * @return {*}
     */
    static getAddress(strPublicKey){
        return this.hash160(strPublicKey)
    }

    static ripemd160 (buffer) {
        return createHash('rmd160').update(buffer).digest().toString('hex');
    }

    static sha1 (buffer) {
        return createHash('sha1').update(buffer).digest().toString('hex');
    }

    static sha256 (buffer) {
        return createHash('sha256').update(buffer).digest().toString('hex');
    }

    static hash160 (buffer) {
        return this.ripemd160(this.sha256(buffer))
    }

    static hash256 (buffer) {
        return this.sha256(this.sha256(buffer))
    }
}

module.exports=CryptoLib;
