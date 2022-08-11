'use strict';

module.exports = () => ({
    visitor: {
        IfStatement: (path) => {
            if (path.node.consequent.type !== 'BlockStatement') {
                path.get("consequent").replaceWithMultiple([path.node.consequent]);
            }

            if (path.node.alternate !== null && path.node.alternate.type !== 'BlockStatement' ) {
                path.get("alternate").replaceWithMultiple([path.node.alternate]);
            }
        },
        ForStatement: (path) => {
            if (path.node.body.type !== 'BlockStatement') {
                path.get("body").replaceWithMultiple([path.node.body]);
            }
        },
        WhileStatement: (path) => {
            if (path.node.body.type !== 'BlockStatement') {
                path.get("body").replaceWithMultiple([path.node.body]);
            }
        },
        DoWhileStatement: (path) => {
            if (path.node.body.type !== 'BlockStatement') {
                path.get("body").replaceWithMultiple([path.node.body]);
            }
        },
    }
});
