const { ADD, MUL, SUB, DIV, MOD, CALLCODE, LOOPITER } = require('../billingPrice');

module.exports = (babel) => {
    const t = babel.types;

    const billCoins = (cost, comment) =>
        babel.parse(`
            // #Bill#${cost}#${comment}
        `);

    const loopInjection = (path) => {
        const bodyType = path.get("body").type;
        if (bodyType === "BlockStatement") {
            path.get("body").unshiftContainer("body", billCoins(LOOPITER, "LOOPITER"));
        }

        if (bodyType === "EmptyStatement") {
            path.get("body").replaceWithMultiple(billCoins(LOOPITER, "LOOPITER"));
        }

        if (bodyType === "ExpressionStatement") {
            path.get("body").replaceWith(t.blockStatement([path.get("body").node]));
            path.get("body").unshiftContainer("body", billCoins(LOOPITER, "LOOPITER"));
        }
    };

    return {
        visitor: {
            CallExpression: (path) => {
                path.insertBefore(billCoins(CALLCODE, "CALLCODE"));
            },
            WhileStatement: (path) => {
                loopInjection(path);
            },
            DoWhileStatement: (path) => {
                loopInjection(path);
            },
            ForStatement: (path) => {
                loopInjection(path);
            },
        },
    };
};
