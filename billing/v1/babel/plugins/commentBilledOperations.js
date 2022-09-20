'use strict';

const fees = require('../billingFees');

module.exports = babel => {
    const billCoins = (fee, comment) =>
        babel.parse(`
            // #BILL#${fee}#${comment}
        `);

    const loopInjection = path => {
        const bodyType = path.get('body').type;
        if (bodyType === 'BlockStatement') {
            path.get('body').unshiftContainer('body', billCoins(fees.LOOPITER, 'LOOPITER'));
        }
    };

    const getParentBlock = path => {
        if (path.node.type === 'BlockStatement' || path.node.type === 'Program') {
            return {type: 'block', path};
        }

        if (
            path.node.type === 'ForStatement' ||
            path.node.type === 'WhileStatement' ||
            path.node.type === 'DoWhileStatement'
        ) {
            return {type: 'loop', path};
        }

        return getParentBlock(path.parentPath);
    };

    const addBillingForOperator = (operator, type, blockPath) => {
        let injectCode;
        switch (type) {
            case 'block':
                injectCode = fn => blockPath.node.body.unshift(fn);
                break;
            case 'loop':
                injectCode = fn => blockPath.get('body').unshiftContainer('body', fn);
                break;
        }

        switch (operator) {
            case '+':
            case '++':
            case '+=':
                injectCode(billCoins(fees.ADD, 'ADD'));
                break;
            case '-':
            case '--':
            case '-=':
                injectCode(billCoins(fees.SUB, 'SUB'));
                break;
            case '*':
            case '*=':
                injectCode(billCoins(fees.MUL, 'MUL'));
                break;
            case '/':
            case '/=':
                injectCode(billCoins(fees.DIV, 'DIV'));
                break;
            case '%':
            case '%=':
                injectCode(billCoins(fees.MOD, 'MOD'));
                break;
            case '**':
            case '**=':
                injectCode(billCoins(fees.EXP, 'EXP'));
                break;

            case '>':
                injectCode(billCoins(fees.GT, 'GT'));
                break;
            case '>=':
                injectCode(billCoins(fees.SGT, 'SGT'));
                break;
            case '<':
                injectCode(billCoins(fees.GT, 'LT'));
                break;
            case '<=':
                injectCode(billCoins(fees.SLT, 'SLT'));
                break;
            case '==':
            case '===':
                injectCode(billCoins(fees.EQ, 'EQ'));
                break;
            case '!=':
            case '!==':
                injectCode(billCoins(fees.NOT, 'NOT'));
                break;
            case '&&':
                injectCode(billCoins(fees.AND, 'AND'));
                break;
            case '||':
                injectCode(billCoins(fees.OR, 'OR'));
                break;
        }
    };

    return {
        visitor: {
            CallExpression: path => {
                if (path.node.callee.type !== 'Super') {
                    path.insertBefore(billCoins(fees.CALLCODE, 'CALLCODE'));
                }
            },
            WhileStatement: path => {
                loopInjection(path);
            },
            DoWhileStatement: path => {
                loopInjection(path);
            },
            ForStatement: path => {
                loopInjection(path);
            },
            BinaryExpression: path => {
                const parentBlockPath = getParentBlock(path);
                addBillingForOperator(path.node.operator, parentBlockPath.type, parentBlockPath.path);
            },
            AssignmentExpression: path => {
                const parentBlockPath = getParentBlock(path);
                addBillingForOperator(path.node.operator, parentBlockPath.type, parentBlockPath.path);
            },
            UpdateExpression: path => {
                const parentBlockPath = getParentBlock(path);
                addBillingForOperator(path.node.operator, parentBlockPath.type, parentBlockPath.path);
            }
        }
    };
};
