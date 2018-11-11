const EventEmitter = require('events');
const net = require('net');
const debug = require('debug')('transport:');
const os = require('os');
const ipaddr = require('ipaddr.js');
const dns = require('dns');
const util = require('util');
const natUpnp = require('nat-upnp');

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

            this._address = options.listenAddr;
            this._port = options.listenPort || Constants.port;
        }

        get publicAddress() {
            return this._publicAddress;
        }

        get privateAddress() {
            return this._privateAddress;
        }

        get port() {
            return this._port;
        }

        /**
         * 
         * @return {Promise<Object[]>}
         */
        async getPortMappings() {
            return this._upnpClient ?
                new Promise((resolve, reject) => {
                    this._upnpClient.getMappings(function (err, results) {
                        if (err) { reject(err); }
                        resolve(results);
                    });
                })
                : undefined;
        }

        /**
         * Get real IP address via uPnP
         * @return {Promise<string>}
         */
        async _getPublicAddress() {
            if (!this._upnpClient) {
                this._upnpClient = natUpnp.createClient();
            }
            return new Promise((resolve, reject) => {
                this._upnpClient.externalIp(function (err, ip) {
                    if (err) { reject(err); }
                    resolve(ip);
                });
            });
        }

        /**
         * Get local IP address from interfaces
         * @return {string}
         */
        _getPrivateAddress() {
            const interfaces = os.networkInterfaces();
            for (let interfaceName in interfaces) {
                const addresses = interfaces[interfaceName].filter(iface => {
                    return iface.family === 'IPv6' && iface.internal === false
                });
                if (addresses.length > 0)
                    return addresses[0].address;
            }
            return undefined;
        }

        /**
         * Check IP address belongs to local interfaces
         * @param {string} ip 
         */
        _checkLocalInterfacesIp(ip) {
            const interfaces = os.networkInterfaces();
            for (let interfaceName in interfaces) {
                if ((interfaces[interfaceName].filter(iface => {
                    return iface.address === ip;
                })).length > 0) {
                    return true;
                }
            }
            
            return false;
        }

        /**
         * Сheck and set addresses which listen
         */
        async setAddresses() {
            if (!ipaddr.isValid(this._address)) {
                try {
                    this._address = await this._getPublicAddress();
                }
                catch (err) {
                    debug(`Error determining external IP address: ${err}`);
                }
                if (ipaddr.isValid(this._address)) {
                    //if you have white ip address
                    if (this._checkLocalInterfacesIp(this._address)) {
                        this._privateAddress = this._address;
                        this._publicAddress = this._address;
                    }
                    else {
                        let mappings = await this.portMappings;
                        if (!mappings || mappings.length === 0){
                            this.portMapping();
                            mappings = await this.portMappings;
                        }
                        if (mappings && mappings.length > 0) {
                            this._privateAddress = mappings[0].private.host;
                            this._publicAddress = this._address;
                        }
                    }
                }
                else {
                    debug(`Listen local IP address: ${err}`);
                    this._privateAddress = this._getPrivateAddress();
                    this._publicAddress = this._getPrivateAddress();
                }
            }
            else {
                debug(`Listen input parameter IP address: ${err}`);
                this._privateAddress = this._address;;
                this._publicAddress = this._address;;
            }
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

        portMapping() {
            if (!this._upnpClient) {
                this._upnpClient = natUpnp.createClient();
            }
            this._upnpClient.portMapping({
                public: this._port,
                private: this._port,
                ttl: 0
            }, function (err) {
                if (err) { debug(`portMapping error`, err); }
            });
        }

        /**
         * @param {String} address - IP address
         * @return {Promise<Ipv6Connection>} new connection
         */
        connect(address, port) {
            return new Promise((resolve, reject) => {
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
            server.listen({ port: this.port, host: this.privateAddress });
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
