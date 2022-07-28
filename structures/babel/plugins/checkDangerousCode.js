const unsupportedOperations = require("../unsupportedOperations");
module.exports = (babel, { setHasUnsupportedOperation }) => ({
    visitor: {
        CallExpression: (path) => {
            for (const command of unsupportedOperations) {
                if (path.toString().startsWith(command)) {
                    setHasUnsupportedOperation(true);
                    path.stop();
                }
            }
        },
    },
});
