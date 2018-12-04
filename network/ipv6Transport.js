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
const publicAddressesRange = require('./publicAddresses');

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
        _getPortMappings(routableAddress, privateAddress) {
            return this._upnpClient ?
                new Promise((resolve, reject) => {
                    const self = this;
                    this._upnpClient.getMappings(function (err, results) {
                        if (err) return reject(err);
                        const mappings = results.filter(mapping => {
                            let res = mapping.public.port === self._port && mapping.private.port === self._port
                            if (routableAddress) res = res && mapping.public.host === routableAddress;
                            if (privateAddress) res = res && mapping.private.host === privateAddress;
                            return res;
                        });
                        if (mappings.length > 0) {
                            resolve(mappings);
                            return;
                        }
                        resolve();
                    });
                })
                : Promise.resolve();
        }

        /**
         * Get real IP address via uPnP
         * @return {Promise<string>}
         */
        _getUpnpRoutableAddress() {
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
         * Get local IP addresses from interfaces
         * @return {string[]}
         */
        _getInterfacesAddresses() {
            let addresses = [];
            const interfaces = os.networkInterfaces();
            for (let interfaceName in interfaces) {
                addresses.concat(interfaces[interfaceName].filter(iface => {
                    return iface.family === 'IPv6' && iface.internal === false
                }).map(iface => iface.address));
            }
            return addresses;
        }

        _getRoutableInterfacesAddress() {
            const addresses = this._getInterfacesAddresses();
            for (let addr of addresses) {
                if (this.constructor.isRoutableIpv6Address(addr))
                    return addr;
            }
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

        /**
         * Exists address in range "private"
         * @param {String} address - IP address
         * @return {boolean} 
         */
        static isPrivateIpAddress(address) {
            const addr = ipaddr.parse(address);
            // TODO: May be need to check other ranges
            return addr.range() === 'private';
        }

        static isRoutableIpv6Address(address) {
            const addr = ipaddr.parse(address);
            if (addr.kind() !== 'ipv6')
                throw new Error('IP address is not ipv6');
            for (let publicAddress of publicAddressesRange) {
                const addrSubnet = publicAddress.split('/');
                if (addr.match(ipaddr.parse(addrSubnet[0]), addrSubnet[1]))
                    return true;
            }
            return false;
        }

        _mapPort(routableAddress, privateAddress) {
            if (!this._upnpClient) {
                this._upnpClient = natUpnp.createClient();
            }
            let mappingOptions = {
                public: {port: this._port},
                private: {port: this._port}
            };
            return new Promise((resolve, reject) => {
                this._upnpClient.portMapping({
                    public: {port: this._port, host: routableAddress},
                    private: {port: this._port, host: privateAddress}
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
            const routableAddress = await this._getRoutableAddress();
            let mappings = await this._getPortMappings(routableAddress);
            if (!mappings || mappings.length === 0) {
                await this._mapPort();
                mappings = await this._getPortMappings();
            }
            if (mappings && mappings.length > 0) {
                return {privateAddress: mappings[0].private.host, routableAddress: mappings[0].public.host || routableAddress};
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

        async _getRoutableAddress() {
            let addr;
            try {
                addr = await this._getUpnpRoutableAddress();
            }
            catch (err) {
                debug(`Error determining external IP address: ${err}`);
            }
            if (!addr) return {};

            return addr;
        }

        _startListen() {
            const server = net.createServer(async (socket) => {
                this.emit('connect',
                    new Ipv6Connection({socket, timeout: this._timeout})
                );
            });

            server.listen({port: this.port, host: this._privateAddress});
        }

        /**
         * Emit 'connect' with new Connection
         *
         */
        async listen() {
            if (this._address) {
                if (!ipaddr.isValid(this._address)) throw new Error('Invalid IP address');

                let addr = ipaddr.parse(this._address);
                //If IPv6 and not IPv4 mapped OR 
                //IPv4 mapped and not private address
                if (ipaddr.IPv6.isIPv6(this._address) && !addr.isIPv4MappedAddress()
                    || ipaddr.IPv6.isIPv6(this._address) && addr.isIPv4MappedAddress() && !this.constructor.isPrivateIpAddress(addr.toIPv4Address().toString())) {
                    this._setAddresses({privateAddress: this._address, routableAddress: this._address});
                    this._startListen();
                    return;
                }
                //Listening address isn't routable
                //Map port
                await this._mapPort(this._address);
                const portMappings = await this._getPortMappings(this._address);
                if (portMappings && Array.isArray(portMappings)) {
                    //TODO: May be need map address to ipv6
                    this._setAddresses({privateAddress: portMappings[0].private.host, routableAddress: portMappings[0].public.host});
                    this._startListen();
                    return;
                }
                else throw new Error('Failed port mapping');
            }
            else {
                let address = this._getRoutableInterfacesAddress();
                if (address) {
                    this._setAddresses({privateAddress: address, routableAddress: address});
                    this._startListen();
                    return;
                }

                this._setAddresses(await this._forceMappingAddress());

                if (this._areAddressOk()) {
                    this._startListen();
                    return;
                }
                else throw new Error('Error determining listen address');
            }
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
            EventBus.removeAllListeners(this._privateAddress);
        }
    };
};
