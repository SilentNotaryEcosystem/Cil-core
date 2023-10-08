### UbixNS contract

```
Contract allows to link provider with username to a wallet address to have a mnemonic way to share
wallet address among other users
```

## Contract has 3 roles:

#### Contract owner (can create new records, add providers, set proxy contract)
```
Owner creates record after check that this provider and name belongs to the user
```

#### Record owner (can delete it's own record(s))

#### Unauthorized user (can resolve records (by username/id receive list of pairs (provider, walletAddress)))

## Contract deployment

```
Donwload https://github.com/trueshura/cil-utils/ project and add load.js file from the current folder to the root folder of сil-utils
Copy contract to the root folder, remove Base class, all require statments and module.exports section
Add creation of a contract instance to the end of the file:

const exports = new Ns();

For dev network
call load.js file from the command line, input private key for a wallet to sign the transaction:

NODE_ENV=Devel node ./load.js

go to your wallet explorer:

https://old-test-explorer.ubikiri.com/#address/Ux[your wallet address here]

And find the latest transaction with the contract code

Copy transaction address from browser address string to the RPC request

curl --location --request POST 'https://rpc-dv-1.ubikiri.com/' \
--header 'Content-Type: application/json' \
--header 'Authorization: Basic Y2lsVGVzdDpkNDljMWQyNzM1NTM2YmFhNGRlMWNjNg==' \
--data-raw '{
  "jsonrpc":"2.0",
  "method":"getTxReceipt",
  "params":{
    "strTxHash": "HERE TRANSACTION ADDRESS"
  },
  "id":67
}'

In reply you will see contractAddress field, it's the contract address to send requests via RPC

```

## UbixNs record creation

```
Copy create.js file from this folder to cil-utils root folder

Update STR_CONTRACT_ADDR to the contract address, received above

Update section objInvokeCode to:

const objInvokeCode = {
    method: 'create',
    arrArguments: ['tg', 'my-tg-nick', '00000000000000000000000000000000000000']
};

call create.js file from the command line, input private key for a wallet to sign the transaction:

NODE_ENV=Devel node ./create.js

Now you could test your new NFT token by RPC request:

curl --location --request POST 'https://rpc-dv-1.ubikiri.com/' \
--header 'Content-Type: application/json' \
--header 'Authorization: Basic Y2lsVGVzdDpkNDljMWQyNzM1NTM2YmFhNGRlMWNjNg==' \
--data-raw '{
  "jsonrpc":"2.0",
  "method":"constantMethodCall",
  "params":{
    "contractAddress": "CONTRACT ADDRESS HERE",
    "method": "resolve",
    "arrArguments": ["my-tg-nick"],
    "completed": true
  },
  "id":67
}'

```

## Deployment of a proxy contract

```
You must be a contract owner to load new proxy contracts

In contract code (ns.js) remove all the blocks marked

// remove for proxy contract!

Change the logic for contract methods and deploy it into blockchain

Load the contract in the same way as in Contract deployment section above

Receive a new contract address

For the original contract address use setProxy(strNewAddress) method to use new logic for all contract data:

Copy create.js file from this folder to cil-utils root folder

Update STR_CONTRACT_ADDR to the original contract address, received above

Update section objInvokeCode to:

const objInvokeCode = {
    method: 'setProxy',
    arrArguments: ['NEW CONTRACT ADDRESS']
};

call create.js file from the command line, input private key for a wallet to sign the transaction:

NODE_ENV=Devel node ./create.js

Users will use the same old contract address to call the contract:

curl --location --request POST 'https://rpc-dv-1.ubikiri.com/' \
--header 'Content-Type: application/json' \
--header 'Authorization: Basic Y2lsVGVzdDpkNDljMWQyNzM1NTM2YmFhNGRlMWNjNg==' \
--data-raw '{
  "jsonrpc":"2.0",
  "method":"constantMethodCall",
  "params":{
    "contractAddress": "ORIGINAL CONTRACT ADDRESS HERE",
    "method": "resolve",
    "arrArguments": ["my-tg-nick"],
    "completed": true
  },
  "id":67
}'

But it will use the updated processing logic from the proxy contract

```

## Contract methods:

#### getProviders();

```
Returns supported provider list (ie: ig, tg, email)
```

#### addProvider(strProvider);

```
Will add a new provider to list
Parameter type: provider name, string
```

#### setProxy(strNewAddress);

```
Set new contract proxy to change processing logic
Parameter type: proxy contract address, string
```

#### resolve(strName);

```
Returns list of providers and addresses for a specific name
Parameter type: username/id to search, string
```

#### create(strProvider, strName, strWalletAddress);

```
Creates a new UbixNS record by the contract owner
hash(strProvider, strName) points to strWalletAddress

This method could be called only by the contract owner
User must pay fee for the creation first in UI

Parameter types:
  provider name (ie email), string
  username/id, string
  wallet address, string
```

#### remove(strProvider, strName)

```
Removes a record if a wallet owner wants to delete it
Parameter types:
  provider name (ie email), string
  username/id, string
```
