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

        // After replacement of every loop string operator to block operator this code must not be used
        if (bodyType === "EmptyStatement") {
            path.get("body").replaceWithMultiple(billCoins(LOOPITER, "LOOPITER"));
        }

        if (bodyType === "ExpressionStatement") {
            path.get("body").replaceWith(t.blockStatement([path.get("body").node]));
            path.get("body").unshiftContainer("body", billCoins(LOOPITER, "LOOPITER"));
        }
    };

    const getParentBlock = (path) => {
        if (path.node.type === 'BlockStatement' || path.node.type === 'Program') {
            return { type: 'block', path };
        }

        if (path.node.type === 'ForStatement' || path.node.type === 'WhileStatement' || path.node.type === 'DoWhileStatement') {
            return { type: 'loop', path };
        }

        return getParentBlock(path.parentPath);
    }

    const addBillingForOperator = (operator, type, blockPath) => {
        let injectCode;
        switch (type) {
            case 'block':
                injectCode = (fn) => blockPath.node.body.unshift(fn);
                break;
            case 'loop':
                injectCode = (fn) => blockPath.get("body").unshiftContainer("body", fn)
                break;
        }

        switch (operator) {
            case "+":
                injectCode(billCoins(ADD, 'ADD'));
                break;
            case "-":
                injectCode(billCoins(SUB, 'SUB'));
                break;
            case "*":
                injectCode(billCoins(MUL, 'MUL'));
                break;
            case "/":
                injectCode(billCoins(DIV, 'DIV'));
                break;
            case "%":
                injectCode(billCoins(MOD, 'MOD'));
                break;
        }
    }

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
            BinaryExpression: (path) => {
                const parentBlockPath = getParentBlock(path);
                addBillingForOperator(path.node.operator, parentBlockPath.type, parentBlockPath.path);
            }
        },
    };
};