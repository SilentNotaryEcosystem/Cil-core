'use strict';

const {ADD, MUL, SUB, DIV, MOD, EXP, CALLCODE, LOOPITER} = require('../billingPrice');

module.exports = babel => {
    const billCoins = (cost, comment) =>
        babel.parse(`
            // #BILL#${cost}#${comment}
        `);

    const loopInjection = path => {
        const bodyType = path.get('body').type;
        if (bodyType === 'BlockStatement') {
            path.get('body').unshiftContainer('body', billCoins(LOOPITER, 'LOOPITER'));
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
                injectCode(billCoins(ADD, 'ADD'));
                break;
            case '-':
            case '--':
            case '-=':
                injectCode(billCoins(SUB, 'SUB'));
                break;
            case '*':
            case '*=':
                injectCode(billCoins(MUL, 'MUL'));
                break;
            case '/':
            case '/=':
                injectCode(billCoins(DIV, 'DIV'));
                break;
            case '%':
            case '%=':
                injectCode(billCoins(MOD, 'MOD'));
                break;
            case '**':
            case '**=':
                injectCode(billCoins(EXP, 'EXP'));
                break;
        }
    };

    return {
        visitor: {
            CallExpression: path => {
                if (path.node.callee.type !== 'Super') {
                    path.insertBefore(billCoins(CALLCODE, 'CALLCODE'));
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