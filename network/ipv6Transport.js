const EventEmitter = require('events');
const net = require('net');
const debug = require('debug')('transport:');
const os = require('os');
const ipaddr = require('ipaddr.js');
const dns = require('dns');
const util = require('util');
const natUpnp = require('nat-upnp');

const {sleep} = require('../utils');
const ConnectionWrapper = require('./ipv6Connection');

/**

 */

const EventBus = new EventEmitter();

module.exports = (factory) => {
    const {Serializer, MessageAssembler, Constants} = factory;
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

        get routableAddress() {
            return this._routableAddress;
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
        _getPortMappings() {
            return this._upnpClient ?
                new Promise((resolve, reject) => {
                    const self = this;
                    this._upnpClient.getMappings(function (err, results) {
                        if (err) return reject(err);
                        const mappings = results.filter(mapping => mapping.public.port === self._port && mapping.private.port === self._port);
                        if (mappings.length > 0)
                            resolve(results);
                        resolve();
                    });
                })
                : Promise.resolve();
        }

        /**
         * Get real IP address via uPnP
         * @return {Promise<string>}
         */
        _getUpnpRealAddress() {
            if (!this._upnpClient) {
                this._upnpClient = natUpnp.createClient();
            }
            return new Promise((resolve, reject) => {
                this._upnpClient.externalIp(function (err, ip) {
                    if (err) return reject(err);
                    resolve(ip);
                });
            });
        }

        /**
         * Get local IP address from interfaces
         * @return {string}
         */
        _getLocalAddress() {
            const interfaces = os.networkInterfaces();
            for (let interfaceName in interfaces) {
                const addresses = interfaces[interfaceName].filter(iface => {
                    return iface.family === 'IPv6' && iface.internal === false
                });
                if (addresses.length > 0) return addresses[0].address;
            }
            return undefined;
        }

        /**
         * Check IP address belongs to local interfaces
         * @param {string} ip 
         */
        _isInterfaceAddress(ip) {
            const objInterfaces = os.networkInterfaces();
            for (let arrAddresses of Object.values(objInterfaces)) {
                if (arrAddresses.find(iface => iface.address === ip)) return true;
            }
            return false;
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

        _mapPort() {
            if (!this._upnpClient) {
                this._upnpClient = natUpnp.createClient();
            }
            return new Promise((resolve, reject) => {
                this._upnpClient.portMapping({
                    public: this._port,
                    private: this._port,
                    ttl: 0
                }, (err) => {
                    if (err) {
                        debug(`portMapping error`, err);
                        return reject(err);
                    }
                    resolve();
                });
            });
        }

        /**
         * For tests
         */
        unmapPort() {
            if (this._upnpClient) {
                this._upnpClient.portUnmapping({
                    public: this._port
                });
            }
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
                        resolve(new Ipv6Connection({socket, timeout: this._timeout}));
                    }
                );
                socket.on('error', err => reject(err));
            });
        }

        /**
         * uPnP port mapping, set result addresses
         */
        async _forceMappingAddress() {
            let mappings = await this._getPortMappings();
            if (!mappings || mappings.length === 0) {
                this._mapPort();
                mappings = await this._getPortMappings();
            }
            if (mappings && mappings.length > 0) {
                return {privateAddress: mappings[0].private.host};
            }
            return {};
        }

        _setAddresses({privateAddress, routableAddress}) {
            this._privateAddress = this._privateAddress || privateAddress;
            this._routableAddress = this._routableAddress || routableAddress;
        }

        /**
         * 
         * @param {string} ip 
         */
        static getIpv6MappedAddress(ip) {
            if (!ipaddr.isValid(ip)) throw new Error('IP address is not valid');
            const address = ipaddr.parse(ip);
            if (address.kind() === 'ipv6') return ip;
            else return address.toIPv4MappedAddress().toString();
        }

        /**
         * 
         * @return {boolean} exists private & public addresses
         */
        _areAddressOk() {
            return ipaddr.isValid(this._privateAddress) && ipaddr.isValid(this._routableAddress);
        }

        async _getRealAddress() {
            let addr;
            try {
                addr = await this._getUpnpRealAddress();
            }
            catch (err) {
                debug(`Error determining external IP address: ${err}`);
            }
            if (!addr) return {};
            if (this._isInterfaceAddress(addr)) {
                return {privateAddress: addr, routableAddress: addr};
            }
            return {routableAddress: addr};
        }

        /**
         * Emit 'connect' with new Connection
         *
         */
        async listen() {
            if (ipaddr.isValid(this._address)) {
                this._address = this.constructor.getIpv6MappedAddress(this._address);
                this._setAddresses({privateAddress: this._address, routableAddress: this._address});
            }
            if (!this._areAddressOk()) {
                this._setAddresses(await this._getRealAddress());
            }
            if (!this._areAddressOk()) {
                this._setAddresses(await this._forceMappingAddress());
            }
            if (!this._areAddressOk()) {
                const addr = this._getLocalAddress();
                this._setAddresses({privateAddress: addr, routableAddress: addr});
            }

            if (!this._areAddressOk()) {
                throw new Error("Error determining listen address");
            }
            this.server = net.createServer(async (socket) => {
                this.emit('connect',
                    new Ipv6Connection({socket, timeout: this._timeout})
                );
            });
            
            this.server.listen({port: this.port, host: this._privateAddress});
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

        /**
         * For tests
         */
        stopServer() {
            if (this.server) this.server.close();
        }

        cleanUp() {
            EventBus.removeAllListeners(this._privateAddress);
        }
    };
};
