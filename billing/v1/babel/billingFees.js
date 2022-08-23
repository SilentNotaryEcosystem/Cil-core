'use strict';

// https://ethereum.stackexchange.com/questions/11474/is-there-a-table-of-evm-instructions-and-their-gas-costs
module.exports = {
    ADD: 3,
    MUL: 5,
    SUB: 3,
    DIV: 5,
    MOD: 5,
    EXP: 10,
    LT: 3,
    GT: 3,
    SLT: 3,
    SGT: 3,
    EQ: 3,
    AND: 3,
    OR: 3,
    NOT: 3,
    CALLCODE: 20,
    LOOPITER: 10
};
