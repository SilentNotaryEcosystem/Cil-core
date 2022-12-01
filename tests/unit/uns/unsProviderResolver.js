const {ADDRESS_TYPE} = require('./constants');

function getUnsProviderResolver(provider, uns) {
    return class ProviderResolver {
        get(name, addresType = ADDRESS_TYPE.DEFAULT) {
            return uns._get(provider, name, addresType);
        }

        add(name, address) {
            uns._add(provider, name, address);
        }

        replace(oldName, newName, address) {
            uns._remove(provider, oldName);
            uns._add(provider, newName, address);
        }

        remove(name) {
            uns._remove(provider, name);
        }
    };
}

module.exports = getUnsProviderResolver;
