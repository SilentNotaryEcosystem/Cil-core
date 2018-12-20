class Base {
    getMethods() {
        return Object
            .getOwnPropertyNames(Object.getPrototypeOf(this))
            .filter(name => name !== 'constructor' && typeof this[name] === 'function');
    }
};
