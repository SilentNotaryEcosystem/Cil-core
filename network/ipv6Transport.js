const EventEmitter = require('events');
const net = require('net');
const debug = require('debug')('transport:');
const os = require('os');
const ipaddr = require('ipaddr.js');
const dns = require('dns');
const util = require('util');

const pathPrefix = os.platform() === 'win32' ? '\\\\?\\pipe' : '';

const { sleep } = require('../utils');
const ConnectionWrapper = require('./ipv6Connection');

/**

 */

const EventBus = new EventEmitter();

module.exports = (factory) => {
    const { Serializer, MessageAssembler, Constants } = factory;
    const Ipv6Connection = ConnectionWrapper(Serializer, MessageAssembler, Constants);

    return class Ipv6Transport extends EventEmitter {

        /**
         *
         * @param {Object} options
         */
        constructor(options) {
            super();
            if (!options) options = {};

            this._timeout = options.timeout || Constants.CONNECTION_TIMEOUT;

            this._address = this.constructor.parseAddress(options.listenAddr);
            this._port = options.listenPort || Constants.port;
        }

        get myAddress() {
            return this._address;
        }

        get port() {
            return this._port;
        }

        /**
         *
         * @return {string}
         */
        static parseAddress(address) {
            if (!ipaddr.isValid(address)) {
                return this._getRealAddress();
            }
            const addr = ipaddr.parse(address);

            return addr.kind() === 'ipv6'
                ? address
                : addr.toIPv4MappedAddress().toString();
        }

        static _getRealAddress() {
            const interfaces = os.networkInterfaces();
            for (let interfaceName in interfaces) {
                const addresses = interfaces[interfaceName].filter(iface => {
                    return iface.family === 'IPv6' && iface.internal === false
                });
                if (addresses.length > 0)
                    return addresses[0].address;
            }
            return null;
        }

        /**
         *
         * @param name
         * @return {Promise<*|string[]>}
         */
        static async resolveName(name) {
            try {
                const dnsResolveDelegate = util.promisify(dns.resolve);
                return await dnsResolveDelegate(name, 'ANY');
            } catch (err) {
                debug(`dnsName: ${name}; error: ${err}`);
                return null;
            }
        }

        /**
         * @param {String} address - IP address
         * @return {Promise<Ipv6Connection>} new connection
         */
        connect(address, port) {
            return new Promise((resolve, reject) => {
                const addr = ipaddr.parse(address);
                const socket = net.createConnection(port, address,
                    async (err) => {
                        if (err) return reject(err);
                        resolve(new Ipv6Connection({ socket, timeout: this._timeout }));
                    }
                );
                socket.on('error', err => reject(err));
            });
        }

        /**
         * Emit 'connect' with new Connection
         *
         */
        listen() {
            const server = net.createServer(async (socket) => {
                this.emit('connect',
                    new Ipv6Connection({ socket, timeout: this._timeout })
                );
            });
            server.listen({ port: this.port, host: this.myAddress });
        }

        /**
         * Emulate Sync version on listen
         * Useful on tests
         *
         * @return {Promise<Ipv6Connection>} new connection
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
    };
};
