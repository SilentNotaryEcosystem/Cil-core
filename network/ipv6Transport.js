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

const dnsResolve4 = util.promisify(dns.resolve4);
const dnsResolve6 = util.promisify(dns.resolve6);

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

            this._useNatTraversal = options.hasOwnProperty('useNatTraversal') ? options.useNatTraversal : true;
        }

        get listenAddress() {
            return this._address;
        }

        get myAddress() {
            return this._publicAddress || this._address;
        }

        get port() {
            return this._port;
        }

        /**
         * @param {String} address
         * @return {Buffer}
         */
        static strToAddress(address) {
            const addr = this.toIpV6Address(address);
            return Buffer.from(ipaddr.parse(addr).toByteArray());
        }

        static addressToString(buffer) {
            const addr = ipaddr.fromByteArray(new Uint8Array(buffer));
            return (addr.isIPv4MappedAddress() ? addr.toIPv4Address() : addr).toString();
        }

        /**
         * Get local IPv6 addresses of interfaces
         * @return {string[]}
         */
        static getInterfacesIpV6Addresses() {
            let addresses = [];
            const interfaces = os.networkInterfaces();
            for (let interfaceName in interfaces) {
                addresses = addresses.concat(
                    interfaces[interfaceName]
                        .filter(iface => iface.family === 'IPv6' && iface.internal === false)
                        .map(iface => iface.address)
                );
            }
            return addresses;
        }

        /**
         * Get local IPv4 addresses of interfaces
         * @return {string[]}
         */
        static getInterfacesIpV4Addresses() {
            let addresses = [];
            const interfaces = os.networkInterfaces();
            for (let interfaceName in interfaces) {
                addresses = addresses.concat(
                    interfaces[interfaceName]
                        .filter(iface => iface.family === 'IPv4' && iface.internal === false)
                        .map(iface => iface.address)
                );
            }
            return addresses;
        }

        /**
         *
         * @param name
         * @return {Promise<*|string[]>}
         */
        static async resolveName(name) {
            try {
                let arrRecords = await dnsResolve4(name);
                arrRecords.concat(await dnsResolve6(name).catch(err => debug(err)));
                return arrRecords;
            } catch (err) {
                debug(`dnsName: ${name}; error: ${err}`);
                return [];
            }
        }

        /**
         * @param {String || IPv4} address - IP address
         * @return {boolean}
         */
        static isRoutableIpV4Address(address) {
            const addr = typeof address === 'string' ? ipaddr.parse(address) : address;
            if (addr.kind() !== 'ipv4') return false;

            return !ipaddr.IPv4.prototype.SpecialRanges[addr.range()];
        }

        static isRoutableIpV6Address(address) {
            const arrLocalRanges = ['uniqueLocal', 'linkLocal'];
            let addr = typeof address === 'string' ? ipaddr.parse(address) : address;
            if (addr.kind() !== 'ipv6' || arrLocalRanges.includes(addr.range())) return false;

            if (addr.isIPv4MappedAddress()) {
                addr = addr.toIPv4Address();
                return this.isRoutableIpV4Address(addr);
            }

            for (let publicAddress of publicAddressesRange) {
                const addrSubnet = publicAddress.split('/');
                if (addr.match(ipaddr.parse(addrSubnet[0]), addrSubnet[1])) {
                    return true;
                }
            }
            return false;
        }

        /**
         *
         * @param {String} strAddr
         * @returns {boolean}
         */
        static isRoutableAddress(strAddr) {
            const addr = ipaddr.parse(strAddr);
            return this.isRoutableIpV6Address(addr) || this.isRoutableIpV4Address(addr);
        };

        /**
         *
         * @param {string} ip
         */
        static toIpV6Address(ip) {
            if (!ipaddr.isValid(ip)) throw new Error('IP address is not valid');
            const address = ipaddr.parse(ip);
            if (address.kind() === 'ipv6') {
                return ip;
            } else {
                return address.toIPv4MappedAddress().toString();
            }
        }

        static isAddrValid(addr){
            return ipaddr.isValid(addr);
        }

        /**
         *
         * @returns {Promise<String>} - external ip (router IP)
         */
        _mapAddress() {
            if (!this._pmClient) this._pmClient = natUpnp.createClient();

            return new Promise((resolve, reject) => {
                this._pmClient.portMapping({
                    public: this._port,
                    private: {port: this._port, host: this._address}
                }, (err) => {
                    if (err) {
                        debug(`portMapping error`, err);
                        return reject(err);
                    }

                    this._pmClient.externalIp((err, ip) => {
                        if (err) {
                            debug(`externalIp error`, err);
                            return reject(err);
                        }
                        resolve(ip);
                    });
                });
            });
        }

        /**
         * @param {String} address - IP address
         * @param {Number} port
         * @param {String | undefined} localAddress - address connect from
         * @return {Promise<Ipv6Connection>} new connection
         */
        connect(address, port, localAddress) {
            return new Promise((resolve, reject) => {
                const socket = net.createConnection(
                    {port, host: address, localAddress},
                    async (err) => {
                        if (err) return reject(err);
                        resolve(new Ipv6Connection({socket, timeout: this._timeout}));
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
            if (this._address) {
                await this._startListen();

                if (this.constructor.isRoutableAddress(this._address)) {
                    this._publicAddress = this._address;
                    return;
                }

                // try to use NAT traversal for IPv4
                if (!ipaddr.IPv6.isIPv6(this._address) && this._useNatTraversal) {
                    const natAddress = await this._mapAddress().catch(err => console.error(err));
                    if (natAddress && this.constructor.isRoutableIpV4Address(natAddress)) {
                        this._publicAddress = natAddress;
                    }
                }

                // it will be outbound only node (failed to NAT traversal or nonRoutable IPv6)
            } else {

                // have routable IPv6 address
                const [ipV6Address] = this.constructor.getInterfacesIpV6Addresses()
                    .filter(addr => this.constructor.isRoutableIpV6Address(addr));
                if (ipV6Address) {
                    this._address = ipV6Address;
                    return await this.listen();
                }

                // have routable IPv4 address
                const arrAllIpV4Addresses = this.constructor.getInterfacesIpV4Addresses();
                const [ipV4Address] = arrAllIpV4Addresses.filter(addr => this.constructor.isRoutableIpV4Address(addr));
                if (ipV4Address) {
                    this._address = ipV4Address;
                    return await this.listen();
                }

                // pick first non internal ip (see os.networkInterfaces())
                this._address = arrAllIpV4Addresses[0];
                return await this.listen();
            }
        }

        /**
         * Emulate Sync version on listen
         * Useful on tests
         *
         * @return {Promise<Ipv6Connection>} new connection
         */
        listenSync() {
            const prom = new Promise((resolve, reject) => {
                this.once('connect', connection => resolve(connection));
                this.listen().catch(err => reject(err));
            });
            return Promise.race([prom, sleep(this._timeout)]);
        }

        /**
         *
         * @returns {Promise<any>}
         * @private
         */
        _startListen() {
            debug(`Listen on ${this._address}:${this._port}`);
            return new Promise((resolve, reject) => {
                const server = net.createServer(async (socket) => {
                    this.emit('connect',
                        new Ipv6Connection({socket, timeout: this._timeout})
                    );
                });

                server.on('error', e => reject(e));
                server.on('listening', _ => resolve());

                server.listen({port: this._port, host: this._address});
            });

        }
    };
};

