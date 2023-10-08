const sha3 = require('js-sha3');

class Base {
    constructor() {
        this._ownerAddress = callerAddress;
    }

    __getCode() {
        const arrFunctionsToPropagateFromBase = [
            '_checkOwner',
            '_transferOwnership',
            '_validateAddress',
            'addManager',
            'removeManager'
        ];

        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(this))
            .filter(name => name !== 'constructor' && typeof this[name] === 'function')
            .concat(arrFunctionsToPropagateFromBase);
        const objCode = {};
        methods.forEach(strFuncName => {
            const strCodeMethod = this[strFuncName].toString();

            // we prepend code of asynс function with '<'
            const codePrefix = Object.getPrototypeOf(this[strFuncName]).constructor.name === 'AsyncFunction' ? '<' : '';
            const re = new RegExp(`${strFuncName}.*?(\(.*?\).*?\{.*\})`, 'ms');
            const arrMatches = strCodeMethod.match(re);
            if (!arrMatches) throw new Error(`Bad code for ${strFuncName}`);
            objCode[strFuncName] = codePrefix + arrMatches[1];
        });
        return objCode;
    }

    _validateAddress(strAddress) {
        if (strAddress.length !== 40) throw 'Bad address';
    }

    _checkOwner() {
        if (this._ownerAddress !== callerAddress) throw 'Unauthorized call';
    }

    _transferOwnership(strNewAddress) {
        this._checkOwner();
        this._validateAddress(strNewAddress);

        this._ownerAddress = strNewAddress;
    }

    addManager(strManagerAddress) {
        this._validateAddress(strManagerAddress);
        this._checkOwner();

        if (!this._managers) this._managers = [];
        this._managers.push(strManagerAddress);
    }

    removeManager(strManagerAddress) {
        this._validateAddress(strManagerAddress);
        this._checkOwner();

        if (!this._managers) return;
        this._managers = this._managers.filter(strAddr => strAddr !== strManagerAddress);
    }

    _checkManager() {
        if (this._ownerAddress === callerAddress) return;

        if (!this._managers) throw 'Unauthorized call';
        if (!~this._managers.findIndex(strAddr => strAddr === callerAddress)) throw 'Unauthorized call';
    }
}

// ERC-721: Non-Fungible Token Standard
// Supports: ERC721Enumerable
// Supports: ERC-2981: NFT Royalty Standard
class Nft extends Base {
    constructor(nFeeDenominator = 10000) {
        super();

        this._createFee = 130000;
        this._data = {};

        // TokenId -> Owner
        this._owners = {};

        // Owner -> [token list]
        this._ownedTokens = {};

        this._symbol2TokenId = {};

        // TokenID -> approved address
        this._tokenApprovals = {};

        // Owner -> operator -> approvals
        this._operatorApprovals = {};

        this._nFeeDenominator = nFeeDenominator;

        // Contract owner -> [strReceiver, nRoyaltyFraction]
        this._defaultRoyaltyInfo = [null, 0];

        // TokenID -> [strReceiver, nRoyaltyFraction]
        this._tokenRoyaltyInfo = {};
    }

    createToken(objTokenData) {
        if (!callerAddress) throw 'You should sign TX';
        if (value < this._createFee) throw `Create fee is ${this._createFee}`;

        this._validateTokenParameters(objTokenData);

        const {strSymbol, strName, strDescription, strTokenUri, strIssuerName} = objTokenData;

        const strSymbolUpper = strSymbol.toUpperCase();

        const strTokenId = this._createHash(`${callerAddress}:${strSymbol}`);

        this._data[strTokenId] = [
            strSymbolUpper,
            strName,
            strDescription,
            strTokenUri,
            strIssuerName,
            callerAddress, // creator
            block.hash
        ];

        this._symbol2TokenId[strSymbolUpper] = strTokenId;

        if (!this._ownedTokens[callerAddress]) {
            this._ownedTokens[callerAddress] = [];
        }

        this._ownedTokens[callerAddress].push(strTokenId);
        this._owners[strTokenId] = callerAddress;
    }

    getTokenId(strSymbol) {
        this._validateParameterType(strSymbol, 'string', 'strSymbol');

        return this._symbol2TokenId[strSymbol] || null;
    }

    tokenData(strTokenIdOrSymbol, bIsTokenId = true) {
        this._validateParameterType(strTokenIdOrSymbol, 'string', 'strTokenIdOrSymbol');
        this._validateParameterType(bIsTokenId, 'boolean', 'bIsTokenId');

        const strTokenId = bIsTokenId ? strTokenIdOrSymbol : this._symbol2TokenId[strTokenIdOrSymbol];

        const {strSymbol, strName, strDescription, strTokenUri, strIssuerName, strOwner} =
            this._getTokenData(strTokenId);

        return {strSymbol, strName, strDescription, strTokenUri, strIssuerName, strOwner};
    }

    tokenURI(strTokenId) {
        this._validateParameterType(strTokenId, 'string', 'strTokenId');
        return this.tokenData(strTokenId).strTokenUri;
    }

    balanceOf(strOwner) {
        this._validateParameterType(strOwner, 'string', 'strOwner');
        this._validateAddress(strOwner, 'strOwner');

        return !Array.isArray(this._ownedTokens[strOwner]) ? 0 : this._ownedTokens[strOwner].length;
    }

    ownerOf(strTokenId) {
        this._validateParameterType(strTokenId, 'string', 'strTokenId');
        return this._owners[strTokenId];
    }

    transferFrom(strFrom, strTo, strTokenId) {
        if (!callerAddress) throw 'You should sign TX';

        global.bIndirectCall = true;
        this._transfer(strFrom, strTo, strTokenId);
    }

    // if strSpender == null -> no address approved
    approve(strSpender, strTokenId) {
        if (!callerAddress) throw 'You should sign TX';
        if (callerAddress === strSpender) throw new Error("Can't approve for the token owner");

        this._validateParameterType(strSpender, 'string', 'strSpender');
        this._validateParameterType(strTokenId, 'string', 'strTokenId');

        this._validateAddress(strSpender, 'strSpender');

        if (this.ownerOf(strTokenId) !== callerAddress) throw new Error("You aren't an owner");

        this._tokenApprovals[strTokenId] = strSpender;
    }

    getApproved(strTokenId) {
        this._validateParameterType(strTokenId, 'string', 'strTokenId');

        return this._tokenApprovals[strTokenId];
    }

    safeTransferFrom(/*strFrom, strTo, strTokenId, data = null*/) {
        throw new Error('Not implemented');
    }

    setApprovalForAll(strOperator, bApproved) {
        if (!callerAddress) throw 'You should sign TX';
        this._validateParameterType(strOperator, 'string', 'strOperator');
        this._validateParameterType(bApproved, 'boolean', 'bApproved');
        if (callerAddress === strOperator) throw new Error("Can't approve for the token owner");
        this._validateAddress(strOperator, 'strSpender');

        if (!this._operatorApprovals[callerAddress]) {
            this._operatorApprovals[callerAddress] = [];
        }

        this._operatorApprovals[callerAddress][strOperator] = bApproved;
    }

    isApprovedForAll(strOwner, strOperator) {
        return !!this._operatorApprovals[strOwner] && this._operatorApprovals[strOwner][strOperator];
    }

    // The enumeration extension for ERC-721, OPTIONAL
    totalSupply() {
        return Object.keys(this._data).length;
    }

    tokenByIndex(nIndex) {
        this._validateParameterType(nIndex, 'number', 'nIndex');
        if (nIndex < 0 || nIndex > this.totalSupply() - 1) throw new Error('nIndex out of range');

        const strTokenId = Object.keys(this._data)[nIndex];

        return this.tokenData(strTokenId);
    }

    tokenOfOwnerByIndex(strOwner, nIndex) {
        this._validateParameterType(strOwner, 'string', 'strOwner');
        this._validateParameterType(nIndex, 'number', 'nIndex');
        if (nIndex < 0 || nIndex > this.balanceOf(strOwner) - 1) throw new Error('nIndex out of range');

        return this.tokenData(this._ownedTokens[strOwner][nIndex]);
    }

    // ERC-2981: NFT Royalty Standard
    royaltyInfo(strTokenId, nSalePrice) {
        this._validateParameterType(strTokenId, 'string', 'strTokenId');
        this._validateParameterType(nSalePrice, 'number', 'nSalePrice');

        if (!this._data[strTokenId]) throw new Error("strTokenId doesn't exist");

        let arrRoyalty = this._tokenRoyaltyInfo[strTokenId];

        if (!arrRoyalty || !arrRoyalty[0]) {
            arrRoyalty = this._defaultRoyaltyInfo;
        }

        const nRoyaltyAmount = (nSalePrice * arrRoyalty[1]) / this._feeDenominator();

        return {receiver: arrRoyalty[0], royaltyAmount: nRoyaltyAmount};
    }

    _feeDenominator() {
        return this._nFeeDenominator;
    }

    _setDefaultRoyalty(strReceiver, nFeeNumerator) {
        this._checkOwner();
        this._validateParameterType(strReceiver, 'string', 'strReceiver');
        this._validateParameterType(nFeeNumerator, 'number', 'nFeeNumerator');
        this._validateAddress(strReceiver);

        if (nFeeNumerator > this._feeDenominator()) throw new Error('Royalty fee will exceed salePrice');

        this._defaultRoyaltyInfo = [strReceiver, nFeeNumerator];
    }

    _deleteDefaultRoyalty() {
        this._checkOwner();
        this._defaultRoyaltyInfo = [null, 0];
    }

    _setTokenRoyalty(strTokenId, strReceiver, nFeeNumerator) {
        this._validateParameterType(strTokenId, 'string', 'strTokenId');
        this._validateParameterType(strReceiver, 'string', 'strReceiver');
        this._validateParameterType(nFeeNumerator, 'number', 'nFeeNumerator');
        this._validateAddress(strReceiver);
        if (nFeeNumerator > this._feeDenominator()) throw new Error('Royalty fee will exceed salePrice');
        if (nFeeNumerator < 0) throw new Error('Royalty fee is below 0');
        if (this.ownerOf(strTokenId) !== callerAddress) throw new Error('You are not the owner');

        this._tokenRoyaltyInfo[strTokenId] = [strReceiver, nFeeNumerator];
    }

    _resetTokenRoyalty(strTokenId) {
        this._validateParameterType(strTokenId, 'string', 'strTokenId');
        if (this.ownerOf(strTokenId) !== callerAddress) throw new Error('You are not the owner');

        this._tokenRoyaltyInfo[strTokenId] = [null, 0];
    }

    _validateParameterType(value, strType, strName) {
        if (typeof value !== strType) throw new Error(`${strName} should be a string`);
    }

    _validateTokenParameters(objTokenData) {
        let arrKeys = ['strSymbol', 'strName', 'strDescription', 'strTokenUri', 'strIssuerName'];

        for (const key in objTokenData) {
            this._validateParameterType(objTokenData[key], 'string', key);

            if (!objTokenData[key]) {
                throw new Error(`${key} should not be empty`);
            }

            if (!arrKeys.includes(key)) {
                throw new Error(`${key} is not required`);
            }

            arrKeys = arrKeys.filter(item => item !== key);
        }

        if (arrKeys.length !== 0) {
            throw new Error(`Key(s): '${JSON.stringify(arrKeys)}' are required`);
        }

        const {strSymbol, strTokenUri} = objTokenData;

        if (strSymbol.length > 6) throw new Error('Symbol should be at most 6 chars');
        if (this._symbol2TokenId[strSymbol.toUpperCase()]) throw new Error('Symbol already exists');

        const urlPattern = /^(?:https?):\/\/(\w+:?\w*)?(\S+)(:\d+)?(\/|\/([\w#!:.?+=&%!\-\/]))?/;
        if (!urlPattern.test(strTokenUri)) throw new Error('strTokenUri should be an URI');
    }

    _getTokenData(strTokenId) {
        if (!this._data[strTokenId]) throw new Error("strTokenId doesn't exist");

        const [strSymbol, strName, strDescription, strTokenUri, strIssuerName, , strTxHashChanges] =
            this._data[strTokenId];

        return {
            strSymbol,
            strName,
            strDescription,
            strTokenUri,
            strIssuerName,
            strTxHashChanges
        };
    }

    // Returns whether strSpender is allowed to manage strTokenId.
    _isApprovedOrOwner(strSpender, strTokenId) {
        const strOwner = this.ownerOf(strTokenId);

        if (
            strSpender !== strOwner &&
            !this.isApprovedForAll(strOwner, strSpender) &&
            this.getApproved(strTokenId) !== strSpender
        ) {
            throw new Error('You are not an authorized person');
        }
    }

    _transfer(strFrom, strTo, strTokenId) {
        if (!global.bIndirectCall) throw new Error("You aren't supposed to be here");

        this._validateParameterType(strFrom, 'string', 'strFrom');
        this._validateParameterType(strTo, 'string', 'strTo');

        this._validateAddress(strFrom, 'strFrom');
        this._validateAddress(strTo, 'strTo');

        if (this.ownerOf(strTokenId) !== strFrom) throw new Error('Transfer from incorrect owner');

        this._isApprovedOrOwner(callerAddress, strTokenId);

        // Clear approvals from the previous owner
        delete this._tokenApprovals[strTokenId];

        if (!this._ownedTokens[strTo]) {
            this._ownedTokens[strTo] = [];
        }

        this._ownedTokens[strFrom] = this._ownedTokens[strTo].filter(item => item !== strTokenId);
        this._ownedTokens[strTo].push(strTokenId);

        this._owners[strTokenId] = strTo;
    }

    _createHash(strInput) {
        return sha3.sha3_256(strInput);
    }
}

module.exports = {
    Nft
};
