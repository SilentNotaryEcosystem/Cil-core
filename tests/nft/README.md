## NFT contract

```
Contract implements Non-Fungible Token standart

It means compeletely unique token, which could have only one owner

It implements ERC 721, https://ethereum.org/en/developers/docs/standards/tokens/erc-721/ standart

Like token10 (ERC 20, https://ethereum.org/en/developers/docs/standards/tokens/erc-20/) contract it doesn't support events

safeTransferFrom method isn't supported

createToken, getTokenId, tokenData methods added because of the different contract environment with Etherium EVM

```

## Contract deployment

```
Donwload https://github.com/trueshura/cil-utils/ project and add load.js file from the current folder to the root folder of сil-utils
Copy contract to the root folder, remove Base class, all require statments and module.exports section
Add creation of a contract instance to the end of the file:

const exports = new Nft();

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

## Token creation

```
Copy create.js file from this folder to cil-utils root folder

Update STR_CONTRACT_ADDR to the contract address, received above

Update section objInvokeCode to:

const objInvokeCode = {
    method: 'createToken',
    arrArguments: [{strSymbol: 'TST', strName: 'Test NFT', strDescription: 'My test nft', strTokenUri: 'http://www.test.com', strIssuerName: 'NFT User'}]
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
    "method": "tokenData",
    "arrArguments": ["TST"],
    "completed": true
  },
  "id":67
}'

```

## Contract methods:

#### createToken(objTokenData);

```
Will create a new NFT token

Parameters: {strSymbol, strName, strDescription, strTokenUri, strIssuerName}
Parameter types: object with string fields
strSymbol - NFT unique string label (like market ticker)
strName - token name
strDescription - token description
strTokenUri - an URI to object linked with NFT token
strIssuerName - a name of the issuer

```

#### getTokenId(strSymbol);

```
Get token Id by symbol (string unique NFT label)
Parameter type: token symbol, string
```

#### tokenData(strTokenIdOrSymbol, bIsTokenId = true);

```
Get token data by Id or symbol
Parameter types: token symbol or UID, string, bIsTokenId, bool - shows token Id or symbol
```

#### tokenURI(strTokenId);

```
Get token URI by id
Parameter type: token Id, string
```

#### balanceOf(strOwner);

```
Get token count owned by a user
Parameter type: owner wallet address, string
```

#### ownerOf(strTokenId);

```
Get an owner of the token by token Id
Parameter type: token Id, string
```

#### transferFrom(strFrom, strTo, strTokenId);

```
Transfer token from one owner to another by Id
Parameter types:
  wallet address from, string
  wallet address to, string
  token Id, string
```


#### approve(strSpender, strTokenId);

```
Allow someone to transfer your token
Parameter types:
  wallet address of trusted person to spend your NFT, string
  token Id, string
```

#### getApproved(strTokenId);

```
Get list of approved users to transfer
Parameter type: token Id, string
```

#### setApprovalForAll(strOperator, bApproved);

```
Approve for operator to tranfer all owner's tokens
Parameter types:
 operator address, string
 true if you want to give access, fals to revoke, bool
```

#### isApprovedForAll(strOwner, strOperator);

```
Check if operator approved to transfer all owner's tokens
Parameter types:
  owner wallet address, string,
  operator wallet address, string
```

#### totalSupply()

```
Total NFT token count supplied by a contract
```

#### tokenByIndex(nIndex);

```
Get token by index
Parameter type: index of NFT, number
```

#### tokenOfOwnerByIndex(strOwner, nIndex);

```
Get token by index for a specific owner
Parameter types:
  wallet address, string
  index of NFT, number
```


#### _setDefaultRoyalty(strReceiver, nFeeNumerator)
```
Set default royalty for a NFT creator
Parameter types:
  wallet address for receiving profit, string
  percent count to send to for every token sell (0-100), number
```

#### _setTokenRoyalty(strTokenId, strReceiver, nFeeNumerator)
```
Set royalty for a NFT token
Parameter types:
  token Id, string
  wallet address for receiving profit, string
  percent count to send to for every token sell (0-100), number
```

#### royaltyInfo(strTokenId, nSalePrice)

```
Get royalty payment for the NFT creator for a token by Id
Parameter types:
  token id, string
  sale price, number
```

## Deployment of a proxy contract

```
Contract doesn't support proxy
This code will be added after approve of overall contract code
```