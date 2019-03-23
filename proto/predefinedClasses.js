class Base {
    __getCode() {
        const methods = Object
            .getOwnPropertyNames(Object.getPrototypeOf(this))
            .filter(name => name !== 'constructor' && typeof this[name] === 'function');
        const objCode = {};
        methods.forEach(strFuncName => {
            const strCodeMethod = this[strFuncName].toString();

            // we prepend code of asyn function with '<'
            const codePrefix = Object.getPrototypeOf(this[strFuncName]).constructor.name === 'AsyncFunction' ? '<' : '';
            const re = new RegExp(`${strFuncName}.*?(\(.*?\).*?\{.*\})`, 'm');
            const arrMatches = strCodeMethod.match(re);
            if (!arrMatches) throw new Error(`Bad code for ${strFuncName}`);
            objCode[strFuncName] = codePrefix + arrMatches[1];
        });
        return objCode;
    }
}
