const {describe, it} = require('mocha');
const {assert} = require('chai');
const {sleep} = require('../utils');

describe('BFT consensus (DEMO tests)', () => {
    before(async function() {
        this.timeout(15000);
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should COMMIT on single witness (for example initial)', async () => {
        // Для группы из 1 свидетеля (изначального в частности)
    });

    it('should FAIL 2 witness (no quorum)', async () => {
        // Для 2х свидетелей с одинаковым весом
    });

    it('should COMMIT 2 witness (weighted consensus)', async () => {
        // Для случая когда вляет вес свидетеля
    });

    it('should COMMIT 3 witness', async () => {
        // Для 3х свидетелей с одинаковым весом
    });

    it('should FAIL 3 witness but no transaction (no block)', async () => {
        // Все хорошо, но транзакций нет - нет блока
    });

    it('should FAIL 3 witness, but one of different group', async () => {
        // Все с одинаковым весом, но 3й принадлежит другой группе
    });

    it('should FAIL 3 witness, but one propose higher block height', async () => {
        // Все с одинаковым весом, но 1 предлагает блок на 1 больше чем видят 2 остальных (не получили предыдущий блок)
    });

    it('should FAIL 3 witness, but one propose lowe block height', async () => {
        // Все с одинаковым весом, но 1 предлагает блок на 1 меньше чем видят 2 остальных (не получил предыдущий блок)
    });

    it('should FAIL 3 witness (no consensus on leader)', async () => {
        // 2 одновременно предложили свои блоки. Нет синхронизации по лидеру.
    });

    it('should FAIL 3 witness (no consensus on block)', async () => {
        // по крайней мере 1 не имеет транзакции в мемпуле включенной в блок. Рестартуем раунд.
    });

    it('should FAIL 4 witness (split network)', async () => {
        // свидетели соеденены попарно
    });

});
