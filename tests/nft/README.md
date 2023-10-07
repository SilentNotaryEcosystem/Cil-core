## Contract methods:

#### createToken(objTokenData);

```
Will create a new NFT token

Parameters: {strSymbol, strName, strDescription, strTokenUri, strIssuerName}

```

#### getTokenId(strSymbol);

```
Get token Id by symbol
```

#### tokenData(strTokenIdOrSymbol, bIsTokenId = true);

```
Get token data by Id or symbol
```

#### tokenURI(strTokenId);

```
Get token URI by id
```

#### balanceOf(strOwner);

```
Get token count owned by a user
```

#### ownerOf(strTokenId);

```
Get an owner of the token by token Id
```

#### transferFrom(strFrom, strTo, strTokenId);

```
Transfer token from one owner to another by Id
```


#### approve(strSpender, strTokenId);

```
Allow someone to transfer your token
```

#### getApproved(strTokenId);

```
Get list of approved users to transfer
```

#### setApprovalForAll(strOperator, bApproved);

```
Approve for operator to tranfer all owner's tokens
```

#### isApprovedForAll(strOwner, strOperator);

```
Check if operator approved to transfer all owner's tokens
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
```

#### royaltyInfo(strTokenId, nSalePrice)

```
Set royalty info for a token by Id
```