[Russian version of document](README.rus.md)

## The installation process (Linux, macOS, Windows):

#### 1. Git clone the project

```
git clone https://github.com/SilentNotaryEcosystem/Cil-core.git
cd Cil-core
git checkout tags/latest
```

#### 2. Setup [Node.js (10.15.2) и npm](https://nodejs.org/dist/v10.15.2/node-v10.15.2.pkg)

#### 3. Setup dependencies and run a Node.js App

```
npm install
node index.js // node install
node savePrivateKey.js` //write private key to file (keystore analog)
```

## The installation process (Docker):

setup docker first [manual for Digical Ocean](https://www.digitalocean.com/community/tutorials/how-to-install-and-use-docker-on-ubuntu-18-04)
then

```
sudo docker pull trueshura/cil-core-prod
```

then download & untar helper scripts

```$xslt
wget -t0 -c https://github.com/SilentNotaryEcosystem/Cil-core/releases/download/v0.2.0-staging/docker-scripts.tgz
tar fxz docker-scripts.tgz
```

pick desired scenario & run script from corresponding directory

## Settings for launch

The default options are set in file [prod.conf.js](https://github.com/SilentNotaryEcosystem/Cil-core/blob/devel/config/prod.conf.js) (for production net) and [devel.conf.js](https://github.com/SilentNotaryEcosystem/Cil-core/blob/devel/config/devel.conf.js) (for development net).

| Parameter            | Description                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| listenAddr           | URL                                                                                                                                 |
| port                 | Specified port                                                                                                                      |
| seedAddr             | Seed address to run Node                                                                                                            |
| rpcUser              | Username used to call the functions from Node                                                                                       |
| rpcPass              | Password used to call the functions from Node                                                                                       |
| rpcPort              | Port used to call the functions from Node                                                                                           |
| rpcAddress           | Address used to call the functions from Node                                                                                        |
| genesisHash          | The genesis block's hash to set up a test environment                                                                               |
| conciliumDefContract | The genesis block's contract to set up a test environment                                                                           |
| privateKey           | Private key file to run a witness node                                                                                              |
| dbPath               | Directory for storing database files                                                                                                |
| seed                 | Running node as a seed (It will store and distribute the addresses of those who are connected to it (peers))                        |
| strictAddresses      | Source address from tcp connection should match address advertised via MSG_VERSION                                                  |
| trustAnnounce        | Use MSG_VERSION to determine node address                                                                                           |
| txIndex              | Function used to get transaction index by its hash                                                                                  |
| watchAddress         | Function used to operate with local wallets. Used for adding wallet address to Node to track all incoming and outgoing transactions |
| reIndexWallet        | Function used to operate with old wallets. Used to receive all transactions in the database by the specified wallet address         |
| walletSupport        | Boolean function used by Node to support the wallet                                                                                 |
| listWallets          | Service function used to see the list of addresses that are added to the Node                                                       |
| suppressJoinTx       | Set to to prevent witness to create joinTx                                                                                          |
| disableDagIndex      | Disable reduce memory usage via DAG index                                                                                           |

## Node install for development net

Set the environment variable `NODE_ENV=Devel`.

To display debug information, you must set a variable `DEBUG=peer:*,node:*`.

In components that support debugging at the beginning of the file there is a tag that is used for debugging.

Example (Linux):

```
NODE_ENV=Devel DEBUG=peer:*,node:* node index.js
```

## Testing

#### Running tests

`npm test`

#### Running tests with debug output (\*nix)

`npm run-script testDebugNix`

#### Running tests with debug output (Windows)

`npm run-script testDebugWin`
