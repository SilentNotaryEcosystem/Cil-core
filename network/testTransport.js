const EventEmitter = require('events');
const uuid = require('node-uuid');
const net = require('net');
const path = require('path');
const debug = require('debug')('transport:');
const os = require('os');
const fs = require('fs');

const pathPrefix = os.platform() === 'win32' ? '\\\\?\\pipe' : '';

const {sleep} = require('../utils');
const TestConnectionWrapper = require('./testConnection');
const ipaddr = require("ipaddr.js");

/**
 * Это тестовый транспорт
 * Может эмулировать задержку через options.delay
 */


const createPipeName = (address) => path.join(`${pathPrefix}`, os.tmpdir(), `cil-addr-${address}`);

const EventBus = new EventEmitter();

module.exports = (factory) => {
    const {Serializer, MessageAssembler, Constants} = factory;
    const TestConnection = TestConnectionWrapper(Serializer, MessageAssembler, Constants);

    return class TestTransport extends EventEmitter {

        /**
         *
         * @param {Object} options
         * @param {Number} options.delay
         */
        constructor(options) {
            super();

            this._delay = options.delay !== undefined ? options.delay : parseInt(Math.random() * 1000);
            this._timeout = options.timeout || Constants.CONNECTION_TIMEOUT;

            // here should be some public address @see os.networkInterfaces
            // this._address is a Buffer
            this._address = options.listenAddr || this.constructor.generateAddress();
            this._port = options.listenPort || Constants.port;
        }

        get listenAddress() {
            return this._address;
        }

        /**
         *
         * @returns {String} !!!
         */
        get myAddress() {
//            if (!this._cachedAddr) {
//                this._cachedAddr = this.constructor.strToAddress(this._address);
//            }
//            return this._cachedAddr;
            return this._address;
        }

        get port() {
            return this._port;
        }

        /**
         * Return at least 16 bytes (length of ipv6 address) buffer created from address
         * If needed it will be padded with 0 from start
         * Will be replaced with real ipv6 buffer
         *
         * @param {String} address
         * @return {Buffer}
         */
        static strToAddress(address) {
            const buffer = Buffer.from(address, 'hex');
            const bytestoPadd = buffer.length > 16 ? 0 : 16 - buffer.length;
            return bytestoPadd ? Buffer.concat([Buffer.alloc(bytestoPadd), buffer]) : buffer;
        }

        static addressToString(buffer, encoding = 'hex') {
            let i = 0;

            // skip leading 0
            for (; i < buffer.length && !buffer[i]; i++) {}
            return buffer.toString(encoding, i);
        }

        /**
         * for test purposes. Valid address starts with number.
         * @param addr
         * @returns {boolean}
         */
        static isAddrValid(addr){
            return (new RegExp('^[0-9]')).test(addr);
        }

        /**
         * Dummy
         *
         * @returns {boolean}
         */
        static isRoutableAddress() {
            return true;
        }

        /**
         * Only for tests
         *
         * @return {String} !!
         */
        static generateAddress() {

            // this awful construction will format address as needed (pad with zeroes ahead)
            return this.addressToString(this.strToAddress(uuid.v4().substring(0, 8)));
        }

        /**
         * Dummy. Not used in test transport
         *
         * @param address
         * @returns {*}
         */
        static toIpV6Address(address) {
            return address;
        }

        static isPrivateAddress(address) {
            return false;
        }

        /**
         * split name by ':'
         *
         * @param name
         * @return {Promise<*|string[]>}
         */
        static async resolveName(name) {
            return name.split('-');
        }

        /**
         * @param {String | Buffer} address - строка которую будем использовать в отдельного топика в EventEmitter
         * @return {Promise<TestConnection>} new connection
         */
        connect(address) {
            if (Buffer.isBuffer(address)) address = this.constructor.addressToString(address, 'hex');

            const netAddr = createPipeName(address);

            return new Promise((resolve, reject) => {
                const socket = net.createConnection(netAddr,
                    async (err) => {
                        if (err) return reject(err);
                        const remoteAddress = Buffer.from(await this._exchangeAddresses(socket), 'hex');
                        if (this._delay) await sleep(this._delay);
                        resolve(
                            new TestConnection({delay: this._delay, socket, timeout: this._timeout, remoteAddress}));
                    }
                );
                socket.on('error', err => reject(err));
            });
        }

        /**
         * Emit 'connect' with new Connection
         *
         */
        async listen() {

            // for test only
            const netAddr = createPipeName(this._address);

            // Unix sockets are persistent, let's erase it first
            try {
                fs.statSync(netAddr);
                fs.unlinkSync(netAddr);
            } catch (err) {}

            net.createServer(async (socket) => {
                const remoteAddress = Buffer.from(await this._exchangeAddresses(socket), 'hex');
                this.emit('connect',
                    new TestConnection({delay: this._delay, socket, timeout: this._timeout, remoteAddress})
                );
            }).listen(netAddr);
        }

        /**
         * Emulate Sync version on listen
         * Useful on tests
         *
         * @return {Promise<TestConnection>} new connection
         */
        listenSync() {
            const prom = new Promise(resolve => {
                this.listen();
                this.once('connect', connection => resolve(connection));
            });
            return Promise.race([prom, sleep(this._timeout)]);
        }

        cleanUp() {
            EventBus.removeAllListeners(this._address);
        }

        /**
         *
         * @param {Socket} socket
         * @return {Promise<Buffer>} remoteAddress
         * @private
         */
        _exchangeAddresses(socket) {
            debug(`sending my address: ${this._address}`);
            socket.write(TestTransport.strToAddress(this._address));

            return new Promise((resolve, reject) => {
                socket.once('data', (addressBuff) => {
                    debug(`got remote address: ${TestTransport.addressToString(addressBuff)}`);
                    resolve(addressBuff);
                });
            });
        }
    };
};
