## NFT contract

```
It implements ERC 721, https://ethereum.org/en/developers/docs/standards/tokens/erc-721/ standart

Like token10 (ERC 20, https://ethereum.org/en/developers/docs/standards/tokens/erc-20/) contract it doesn't support events

safeTransferFrom method isn't supported

createToken, getTokenId, tokenData methods added because of the different contract environment with Etherium EVM

```

## Contract methods:

#### createToken(objTokenData);

```
Will create a new NFT token

Parameters: {strSymbol, strName, strDescription, strTokenUri, strIssuerName}
Parameter types: strings

```

#### getTokenId(strSymbol);

```
Get token Id by symbol (string unique NFT label)
Parameter type: string
```

#### tokenData(strTokenIdOrSymbol, bIsTokenId = true);

```
Get token data by Id or symbol
Parameter types: string, bool
```

#### tokenURI(strTokenId);

```
Get token URI by id
Parameter type: string
```

#### balanceOf(strOwner);

```
Get token count owned by a user
Parameter type: string
```

#### ownerOf(strTokenId);

```
Get an owner of the token by token Id
Parameter type: string
```

#### transferFrom(strFrom, strTo, strTokenId);

```
Transfer token from one owner to another by Id
Parameter type: string
```


#### approve(strSpender, strTokenId);

```
Allow someone to transfer your token
Parameter type: string
```

#### getApproved(strTokenId);

```
Get list of approved users to transfer
Parameter type: string
```

#### setApprovalForAll(strOperator, bApproved);

```
Approve for operator to tranfer all owner's tokens
Parameter types: string, bool
```

#### isApprovedForAll(strOwner, strOperator);

```
Check if operator approved to transfer all owner's tokens
Parameter types: string, string
```

#### totalSupply()

```
Total NFT token count supplied by a contract
```

#### tokenByIndex(nIndex);

```
Get token by index
```

#### tokenOfOwnerByIndex(strOwner, nIndex);

```
Get token by index for a specific owner
Parameter types: string, number
```

#### royaltyInfo(strTokenId, nSalePrice)

```
Set royalty info for a token by Id
Parameter types: string, number
```

## Deployment of a proxy contract

```
Contract doesn't support proxy
This code will be added after approve of overall contract code
```