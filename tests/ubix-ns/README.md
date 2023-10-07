## Contract has 3 roles:

#### Contract owner (can create new records, add providers, set proxy contract)
#### Record owner (can delete it's own record(s))
#### Unauthorized user (can resolve records (by username/id receive list of pairs (provider, walletAddress)))


## Contract methods:

#### getProviders();

```
Returns supported provider list (ie: ig, tg, email)
```

#### addProvider(strProvider);

```
Will add a new provider to list
Parameter type: string
```

#### setProxy(strNewAddress);

```
Set new contract proxy to change processing logic
Parameter type: string
```

#### resolve(strName);

```
Returns list of providers and addresses for a specific name
Parameter type: string
```

#### create(strProvider, strName, strWalletAddress);

```
Creates a new UbixNS record by the contract owner
hash(strProvider, strName) points to strWalletAddress
Parameter types: string, string, string
```

#### remove(strProvider, strName)

```
Removes a record if a wallet owner wants to delete it
Parameter types: string, string
```

## Deployment of a proxy contract

```
You must be a contract owner to load new proxy contracts

In contract code (ns.js) remove all the blocks marked

// remove for proxy contract!

Change the logic for contract methods and deploy it into blockchain
Receive a new contract address

For the original contract address use setProxy(strNewAddress) method to use new logic for all contract data

Users will use the same old contract address to call the contract

```