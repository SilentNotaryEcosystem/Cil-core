## Contract methods:

#### getProviders();

```
Returns provider list
```

#### addProvider(strProvider);

```
Will add a provider
```

#### setProxy(strNewAddress);

```
Set new contract proxy to change processing logic
```

#### resolve(strName);

```
Returns list of providers and addresses for a specific name
```

#### create(strProvider, strName, strWalletAddress);

```
Creates a new UbixNS record by the contract owner
```

#### remove(strProvider, strName)

```
Removes a record if a wallet owner wants to delete it
```
