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
        RegExpLiteral: (path) => {
            setHasUnsupportedOperation(true);
            path.stop();
        },
        Identifier: (path) => {
            if (path.node.name === 'RegExp') {
                setHasUnsupportedOperation(true);
                path.stop();
            }
        },
        ArrowFunctionExpression: (path) => {
            setHasUnsupportedOperation(true);
            path.stop();
        }
    },
});
