class Base {
    getCode() {
        const methods = Object
            .getOwnPropertyNames(Object.getPrototypeOf(this))
            .filter(name => name !== 'constructor' && typeof this[name] === 'function');
        return methods.map(strFuncName => this[strFuncName].toString());
    }
};
