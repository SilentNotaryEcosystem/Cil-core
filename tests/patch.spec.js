'use strict';

const {describe, it} = require('mocha');
const {assert} = require('chai');

const factory = require('./testFactory');
const {arrayEquals} = require('../utils');
const {pseudoRandomBuffer, createNonMergeablePatch, generateAddress} = require('./testUtil');

const createUtxo = (arrIndexes) => {
    const txHash = pseudoRandomBuffer(32).toString('hex');

    const utxo = new factory.UTXO({txHash});
    const coins = new factory.Coins(1000, generateAddress());
    arrIndexes.forEach(idx => utxo.addCoins(idx, coins));

    return utxo;
};

const createInternalUtxo = () => new factory.UTXO({txHash: pseudoRandomBuffer()})
    .addCoins(0, factory.Coins.createFromData({amount: 100, receiverAddr: generateAddress()}));

describe('PatchDB', () => {
    before(async function() {
        this.timeout(15000);
        await factory.asyncLoad();
    });

    after(async function() {
        this.timeout(15000);
    });

    it('should create instance', async () => {
        new factory.PatchDB(0);
    });

    it('should add coins to same UTXO', async () => {
        const patch = new factory.PatchDB(0);
        const txHash = pseudoRandomBuffer(32).toString('hex');
        const coins = new factory.Coins(10, generateAddress());
        patch.createCoins(txHash, 0, coins);
        patch.createCoins(txHash, 2, coins);

        const mapCoinsToAdd = patch.getCoins();
        assert.isOk(mapCoinsToAdd);
        assert.isOk(mapCoinsToAdd.get(txHash));
        assert.equal(mapCoinsToAdd.size, 1);
        assert.isOk(patch.getUtxo(txHash));
    });

    it('should add coins to different UTXOs', async () => {
        const patch = new factory.PatchDB(0);
        const txHash = pseudoRandomBuffer(32).toString('hex');
        const txHash2 = pseudoRandomBuffer(32).toString('hex');

        const coins = new factory.Coins(10, generateAddress());
        patch.createCoins(txHash, 0, coins);
        patch.createCoins(txHash2, 2, coins);

        const mapCoinsToAdd = patch.getCoins();
        assert.isOk(mapCoinsToAdd);
        assert.isOk(mapCoinsToAdd.get(txHash));
        assert.isOk(mapCoinsToAdd.get(txHash2));
        assert.equal(mapCoinsToAdd.size, 2);

        assert.isOk(patch.getUtxo(txHash));
    });

    it('should SET Coins and GET UTXO', async () => {
        const patch = new factory.PatchDB(0);
        const txHash = pseudoRandomBuffer(32).toString('hex');
        const txHash2 = pseudoRandomBuffer(32).toString('hex');

        const coins = new factory.Coins(10, generateAddress());
        patch.createCoins(txHash, 0, coins);
        patch.createCoins(txHash2, 2, coins);

        const utxo1 = patch.getUtxo(txHash);
        const utxo2 = patch.getUtxo(txHash2);

        assert.isOk(utxo1);
        assert.isOk(utxo2);

        assert.isOk(coins.equals(utxo1.coinsAtIndex(0)));
        assert.isOk(coins.equals(utxo2.coinsAtIndex(2)));
    });

    it('should SET/GET UTXO', async () => {
        const txHash = pseudoRandomBuffer(32);

        const utxo = new factory.UTXO({txHash});
        const coins = new factory.Coins(10, generateAddress());
        utxo.addCoins(0, coins);

        const patch = new factory.PatchDB(0);

        patch.setUtxo(utxo);

        assert.isOk(utxo.equals, patch.getUtxo(txHash));
    });

    it('should remove coins', async () => {
        const patch = new factory.PatchDB(0);
        const spendingTx = pseudoRandomBuffer().toString('hex');

        const utxo = createUtxo([12, 0, 431]);
        const utxo2 = createUtxo([12, 0]);

        patch.spendCoins(utxo, 12, spendingTx);
        patch.spendCoins(utxo, 0, spendingTx);
        patch.spendCoins(utxo, 431, spendingTx);
        patch.spendCoins(utxo2, 12, spendingTx);

        assert.isOk(patch.getCoins());
        assert.equal(patch.getCoins().size, 2);

        const utxoPatched = patch.getUtxo(utxo.getTxHash());
        const utxo2Patched = patch.getUtxo(utxo2.getTxHash());

        assert.isOk(utxoPatched.isEmpty());
        assert.isNotOk(utxo2Patched.isEmpty());

        assert.isOk(utxo2Patched.coinsAtIndex(0));
        assert.throws(() => utxo2Patched.coinsAtIndex(12));
    });

    it('should MERGE patches (source is empty)', async () => {
        const patch = new factory.PatchDB(0);
        const utxo = createUtxo([12, 0, 431]);

        const patch2 = new factory.PatchDB(2);
        const strHash = pseudoRandomBuffer().toString('hex');
        patch2.createCoins(strHash, 17, utxo.coinsAtIndex(12));
        patch2.spendCoins(utxo, 0, pseudoRandomBuffer());

        const resultPatch = patch.merge(patch2);

        assert.isOk(resultPatch.getUtxo(utxo.getTxHash()));
        assert.isOk(resultPatch.getUtxo(strHash));
    });

    it('should MERGE patches (param is empty)', async () => {
        const patch = new factory.PatchDB(0);
        const utxo = createUtxo([12, 0, 431]);

        const strHash = pseudoRandomBuffer().toString('hex');
        patch.createCoins(strHash, 17, utxo.coinsAtIndex(12));
        patch.spendCoins(utxo, 0, pseudoRandomBuffer());

        const resultPatch = patch.merge(new factory.PatchDB(1));

        assert.isOk(resultPatch.getUtxo(utxo.getTxHash()));
        assert.isOk(resultPatch.getUtxo(strHash));
        assert.isOk(resultPatch.getUtxo(strHash) instanceof factory.UTXO);
    });

    it('should have empty UTXO in patch (one empty)', async () => {
        const patch = new factory.PatchDB(0);
        const utxo = createUtxo([1]);
        const spendingTx = pseudoRandomBuffer();

        patch.setUtxo(utxo);

        const patch2 = patch.merge(new factory.PatchDB());
        patch2.spendCoins(utxo, 1, spendingTx);

        {
            const mergedPatch = patch.merge(patch2);

            const utxoPatch = mergedPatch.getUtxo(utxo.getTxHash());
            assert.isOk(utxoPatch);
            assert.isOk(utxoPatch.isEmpty());
        }
        {
            const mergedPatch = patch2.merge(patch);

            const utxoPatch = mergedPatch.getUtxo(utxo.getTxHash());
            assert.isOk(utxoPatch);
            assert.isOk(utxoPatch.isEmpty());
        }
    });

    it('should have empty UTXO in patch (all indexes spend)', async () => {
        const utxo = createUtxo([0, 1, 2, 3]);
        const spendingTx1 = pseudoRandomBuffer();
        const spendingTx2 = pseudoRandomBuffer();

        const patch = new factory.PatchDB(0);
        patch.setUtxo(utxo);
        patch.spendCoins(utxo, 0, spendingTx1);
        patch.spendCoins(utxo, 2, spendingTx1);

        const patch2 = new factory.PatchDB(1);
        patch2.setUtxo(utxo);
        patch2.spendCoins(utxo, 1, spendingTx2);
        patch2.spendCoins(utxo, 3, spendingTx2);

        {
            const mergedPatch = patch.merge(patch2);

            const utxoPatch = mergedPatch.getUtxo(utxo.getTxHash());
            assert.isOk(utxoPatch);
            assert.isOk(utxoPatch.isEmpty());
        }
        {
            const mergedPatch = patch2.merge(patch);

            const utxoPatch = mergedPatch.getUtxo(utxo.getTxHash());
            assert.isOk(utxoPatch);
            assert.isOk(utxoPatch.isEmpty());
        }
    });

    it('should MERGE patches (different outputs same spending TX)', async () => {
        const patch = new factory.PatchDB(0);
        const utxo = createUtxo([12, 0, 431]);
        const spendingTx = pseudoRandomBuffer();

        patch.spendCoins(utxo, 12, spendingTx);

        const patch2 = new factory.PatchDB(1);
        patch2.spendCoins(utxo, 0, spendingTx);

        {
            const mergedPatch = patch.merge(patch2);

            const mapSpentOutputs = mergedPatch._getSpentOutputs(utxo.getTxHash());
            assert.isOk(mapSpentOutputs);
            assert.isOk(arrayEquals(Array.from(mapSpentOutputs.keys()), [0, 12]));

            const resultUtxo = mergedPatch.getUtxo(utxo.getTxHash());
            assert.isOk(resultUtxo);
            assert.isOk(resultUtxo.coinsAtIndex(431));
            assert.throws(() => resultUtxo.coinsAtIndex(0));
            assert.throws(() => resultUtxo.coinsAtIndex(12));
        }
        {
            const mergedPatch = patch2.merge(patch);

            const mapSpentOutputs = mergedPatch._getSpentOutputs(utxo.getTxHash());
            assert.isOk(mapSpentOutputs);
            assert.isOk(arrayEquals(Array.from(mapSpentOutputs.keys()), [0, 12]));

            const resultUtxo = mergedPatch.getUtxo(utxo.getTxHash());
            assert.isOk(resultUtxo);
            assert.isOk(resultUtxo.coinsAtIndex(431));
            assert.throws(() => resultUtxo.coinsAtIndex(0));
            assert.throws(() => resultUtxo.coinsAtIndex(12));
        }
    });

    it('should MERGE patches (same outputs same spending TX)', async () => {
        const patch = new factory.PatchDB(12);
        const patch2 = new factory.PatchDB(0);

        const utxo = createUtxo([12, 0, 431]);
        const spendingTx = pseudoRandomBuffer();
        patch.spendCoins(utxo.clone(), 12, spendingTx);
        patch2.spendCoins(utxo.clone(), 12, spendingTx);

        patch.merge(patch2);
    });

    it('should MERGE patches and maintain _mapSpentUtxos (2 patches, same utxo)', async () => {
        const patch = new factory.PatchDB(12);
        const patch2 = new factory.PatchDB(0);

        const utxo = createUtxo([12, 0, 431]);
        const spendingTx = pseudoRandomBuffer();
        const spendingTx2 = pseudoRandomBuffer();

        patch.spendCoins(utxo.clone(), 12, spendingTx);
        patch2.spendCoins(utxo.clone(), 0, spendingTx2);

        test(patch.merge(patch2));
        test(patch2.merge(patch));

        function test(patchMerged) {
            assert.equal(patchMerged._mapSpentUtxos.size, 1);
            const mapUtxo = patchMerged._mapSpentUtxos.get(utxo.getTxHash());
            assert.isOk(spendingTx.equals(mapUtxo.get(12)));
            assert.isOk(spendingTx2.equals(mapUtxo.get(0)));
        }
    });

    it('should MERGE patches and maintain _mapSpentUtxos (2 patches, different utxo)', async () => {
        const patch = new factory.PatchDB(12);
        const patch2 = new factory.PatchDB(0);

        const utxo = createUtxo([12, 0, 431]);
        const utxo2 = createUtxo([0]);
        const spendingTx = pseudoRandomBuffer();
        const spendingTx2 = pseudoRandomBuffer();

        patch.spendCoins(utxo.clone(), 12, spendingTx);

        // whole spend!
        patch2.spendCoins(utxo2.clone(), 0, spendingTx2);

        test(patch.merge(patch2));
        test(patch2.merge(patch));

        function test(patchMerged) {
            assert.equal(patchMerged._mapSpentUtxos.size, 2);
            const mapUtxo = patchMerged._mapSpentUtxos.get(utxo.getTxHash());
            const mapUtxo2 = patchMerged._mapSpentUtxos.get(utxo2.getTxHash());
            assert.isOk(spendingTx.equals(mapUtxo.get(12)));
            assert.isOk(spendingTx2.equals(mapUtxo2.get(0)));
        }
    });

    it('should MERGE patches and maintain _mapSpentUtxos (epmty patch)', async () => {
        const patch = new factory.PatchDB(12);
        const patchEmpty = new factory.PatchDB(0);

        const utxo = createUtxo([12, 0, 431]);
        const spendingTx = pseudoRandomBuffer();

        patch.spendCoins(utxo.clone(), 12, spendingTx);

        test(patch.merge(patchEmpty));
        test(patchEmpty.merge(patch));

        function test(patchMerged) {
            assert.equal(patchMerged._mapSpentUtxos.size, 1);
            const mapUtxo = patchMerged._mapSpentUtxos.get(utxo.getTxHash());
            assert.isOk(spendingTx.equals(mapUtxo.get(12)));
        }
    });

    it('should fail MERGE patches (same outputs different spending TX)', async () => {
        const patch = new factory.PatchDB(12);
        const patch2 = new factory.PatchDB(12);
        const utxo = createUtxo([12, 0, 431]);

        patch.spendCoins(utxo.clone(), 12, pseudoRandomBuffer());
        patch2.spendCoins(utxo.clone(), 12, pseudoRandomBuffer());

        try {
            patch.merge(patch2);
        } catch (e) {
            return;
        }
        throw ('Unexpected success');
    });

    it('should PURGE patch (complete removal, since equal)', async () => {
        const patch = new factory.PatchDB(0);

        const utxo = createUtxo([12, 0, 431]);
        const creatingTx = pseudoRandomBuffer().toString('hex');
        patch.createCoins(creatingTx, 17, utxo.coinsAtIndex(12));
        const spendingTx = pseudoRandomBuffer().toString('hex');
        patch.spendCoins(utxo, 12, spendingTx);

        const mergedPatch = patch.merge(new factory.PatchDB(1));
        mergedPatch.purge(patch);

        assert.isNotOk(mergedPatch.getUtxo(utxo.getTxHash()));
        assert.isNotOk(mergedPatch.getUtxo(creatingTx));
        assert.isNotOk(mergedPatch.getCoins().size);
    });

    it('should PURGE patch (no changes, since UTXO modified)', async () => {
        const patch = new factory.PatchDB(0);

        const utxo = createUtxo([12, 0, 431]);
        const spendingTx = pseudoRandomBuffer().toString('hex');
        patch.spendCoins(utxo, 12, spendingTx);

        const mergedPatch = patch.merge(new factory.PatchDB(1));
        mergedPatch.setConciliumId(1);
        mergedPatch.spendCoins(utxo, 0, spendingTx);

        const level3Patch = mergedPatch.merge(new factory.PatchDB(0));
        const level3PatchSize = level3Patch.getCoins().size;
        level3Patch.purge(patch);

        assert.isOk(level3Patch.getCoins().size === level3PatchSize);
    });

    it('should NOT PURGE UTXO from patch (UTXO was spent in different TXns)', async () => {
        const utxo = createUtxo([12, 0, 431]);
        const spendingTx = pseudoRandomBuffer().toString('hex');
        const spendingTx2 = pseudoRandomBuffer().toString('hex');

        const patch = new factory.PatchDB(0);
        patch.spendCoins(utxo, 12, spendingTx);

        const patch2 = new factory.PatchDB(0);
        patch2.spendCoins(utxo, 12, spendingTx2);

        const patchDerived = patch.merge(new factory.PatchDB());

        // purge patch from FORK!
        patch2.purge(patch);

        assert.isOk(patch2.getUtxo(utxo.getTxHash()));

        patch2.purge(patchDerived);

        assert.isOk(patch2.getUtxo(utxo.getTxHash()));
    });

    it('should PURGE UTXO from patch (UTXO was spent in same TXns)', async () => {
        const utxo = createUtxo([12, 0, 431]);
        const spendingTx = pseudoRandomBuffer().toString('hex');

        const patch = new factory.PatchDB(0);
        patch.spendCoins(utxo, 12, spendingTx);

        const patch2 = new factory.PatchDB(0);
        patch2.spendCoins(utxo, 12, spendingTx);

        // purge patch from FORK!
        patch2.purge(patch);

        assert.isNotOk(patch2.getUtxo(utxo.getTxHash()));
    });

    it('should get patch COMPLEXITY', async () => {
        const patch = new factory.PatchDB(0);
        const utxo = createUtxo([12, 0, 431]);
        const spendingTx = pseudoRandomBuffer().toString('hex');
        patch.spendCoins(utxo, 12, spendingTx);

        const mergedPatch = patch.merge(new factory.PatchDB(3));
        mergedPatch.spendCoins(utxo, 0, spendingTx);

        assert.isOk(patch.getComplexity() === 1);
        assert.isOk(mergedPatch.getComplexity() === 2);
    });

    it('should create patch that woldn\'t merge', async () => {
        const patch = new factory.PatchDB(0);
        const patchThatWouldntMerge = createNonMergeablePatch(factory);

        assert.throws(() => patch.merge(patchThatWouldntMerge));
        assert.throws(() => patchThatWouldntMerge.merge(patch));
    });

    it('should set level', async () => {
        const conciliumId = 12;
        const patch = new factory.PatchDB(conciliumId);
        assert.equal(patch._mapConciliumLevel.get(conciliumId), 1);
    });

    it('should get level', async () => {
        const patch = new factory.PatchDB(0);
        const patchMerged = patch.merge(new factory.PatchDB(1));

        assert.equal(patchMerged._mapConciliumLevel.get(0), 1);
        assert.equal(patchMerged._mapConciliumLevel.get(1), 1);

        patchMerged.setConciliumId(1);
        assert.equal(patchMerged._mapConciliumLevel.get(1), 2);

        const patchMergedAgain = patchMerged.merge(new factory.PatchDB(1));
        assert.equal(patchMergedAgain._mapConciliumLevel.get(0), 1);
        assert.equal(patchMergedAgain._mapConciliumLevel.get(1), 2);

        patchMergedAgain.setConciliumId(1);
        assert.equal(patchMergedAgain._mapConciliumLevel.get(1), 3);
    });

    it('should set/get contract', async () => {
        const patch = new factory.PatchDB(0);
        const contractAddr = generateAddress().toString('hex');
        const strCode = 'let a=10;';
        const objData = {a: 10};

        {
            const contract = new factory.Contract({
                contractData: objData,
                contractCode: strCode,
                conciliumId: 0
            });
            contract.storeAddress(contractAddr);
            patch.setContract(contract);
        }

        const contract = patch.getContract(contractAddr);
        assert.isOk(contract);
        assert.equal(contract.getCode(), strCode);
        assert.deepEqual(contract.getData(), objData);
    });

    it('should have contract in merge result', async () => {
        const contractAddr = generateAddress().toString('hex');
        const objData = {a: 10};

        const patch = new factory.PatchDB(0);
        {
            const contract = new factory.Contract({
                contractData: objData,
                conciliumId: 0
            });
            contract.storeAddress(contractAddr);
            patch.setContract(contract);
        }

        const patchDerived = patch.merge(new factory.PatchDB(1));
        patchDerived.setConciliumId(1);
        const contract = patchDerived.getContract(contractAddr);

        assert.isOk(contract);
        assert.deepEqual(contract.getData(), objData);
    });

    it('should fail to merge patches (contract belongs to different conciliums)', async () => {
        const contractAddr = generateAddress().toString('hex');

        const patch1 = new factory.PatchDB(0);
        {
            const contract = new factory.Contract({conciliumId: 0});
            contract.storeAddress(contractAddr);
            patch1.setContract(contract);
        }

        const patch2 = new factory.PatchDB(1);
        {
            const contract = new factory.Contract({conciliumId: 1});
            contract.storeAddress(contractAddr);
            patch2.setContract(contract);
        }

        assert.throws(_ => patch1.merge(patch2));
    });

    it('should merge 2 patches with contract data', async () => {
        const contractAddr = generateAddress().toString('hex');
        const patch = new factory.PatchDB(0);

        const contract1 = new factory.Contract({contractData: {value: 1}, conciliumId: 0});
        contract1.storeAddress(contractAddr);
        patch.setContract(contract1);

        const patchDerived = patch.merge(new factory.PatchDB());
        patchDerived.setConciliumId(0);
        const contract2 = new factory.Contract({contractData: {value: 2}, conciliumId: 0});
        contract2.storeAddress(contractAddr);
        patchDerived.setContract(contract2);

        {
            const patchMerged = patch.merge(patchDerived);
            const contract = patchMerged.getContract(contractAddr);
            assert.equal(contract.getData().value, 2);
        }

        {
            const patchMerged = patchDerived.merge(patch);
            const contract = patchMerged.getContract(contractAddr);
            assert.equal(contract.getData().value, 2);
        }
    });

    it('should merge 2 patches (one derived from another)', async () => {
        const patchTip = factory.PatchDB.deserialize(
            'ff0d6f22055f646174616f2205636f696e733b2240666132393031663136643863313931386536346637323734336537396637366230666630623038396131373835336262333062643564653265306231393564356f22075f74784861736822406661323930316631366438633139313865363466373237343365373966373662306666306230383961313738353362623330626435646532653062313935643522055f646174616f220a617272496e646578657341074900490249044906490e49144916240007220a6172724f75747075747341076f2206616d6f756e744e0000000084d79741220c7265636569766572416464725c0a140f95bfeace0e4ff12a73825668d2136ec8dfcd7c7b026f2206616d6f756e744e0000000084d79741220c7265636569766572416464725c0a140f95bfeace0e4ff12a73825668d2136ec8dfcd7c7b026f2206616d6f756e744e0000000084d79741220c7265636569766572416464725c0a140f95bfeace0e4ff12a73825668d2136ec8dfcd7c7b026f2206616d6f756e744e0000000084d79741220c7265636569766572416464725c0a140f95bfeace0e4ff12a73825668d2136ec8dfcd7c7b026f2206616d6f756e744e0000000084d79741220c7265636569766572416464725c0a14255b2782c26fc94cb85c0feddfdab6b8238db1e37b026f2206616d6f756e744e0000000084d79741220c7265636569766572416464725c0a14266da31023665c3c0a1495e3a1146988ee7e80cd7b026f2206616d6f756e744e0000000084d79741220c7265636569766572416464725c0a14266da31023665c3c0a1495e3a1146988ee7e80cd7b022400077b027b022240626562383365333839396239626538313439656565333630353131643834326634663362356636333135613635653433366237326438313661303863333334656f22075f74784861736822406265623833653338393962396265383134396565653336303531316438343266346633623566363331356136356534333662373264383136613038633333346522055f646174616f220a617272496e6465786573410249004902240002220a6172724f75747075747341026f2206616d6f756e744e00000060c3126341220c7265636569766572416464725c0a14961d7815df8cc96d27aa2c483f55c6c1636827757b026f2206616d6f756e744e000000d81b759541220c7265636569766572416464725c0a140f95bfeace0e4ff12a73825668d2136ec8dfcd7c7b022400027b027b022240663932356132326636333738363039636561613165633161616432393964373961653233316530646631326238373733633931343562336636323565333930326f22075f74784861736822406639323561323266363337383630396365616131656331616164323939643739616532333165306466313262383737336339313435623366363235653339303222055f646174616f220a617272496e646578657341014900240001220a6172724f75747075747341016f2206616d6f756e744e000000000088c340220c7265636569766572416464725c0a142a00000000000000ffffffffea000000681b51047b022400017b027b022240353838386661323865323433326130366232376461623966346562326230626265333262393532366535396163363837386361313066363938636562306632616f22075f74784861736822403538383866613238653234333261303662323764616239663465623262306262653332623935323665353961633638373863613130663639386365623066326122055f646174616f220a617272496e6465786573410249004902240002220a6172724f75747075747341026f2206616d6f756e744e0000000053126341220c7265636569766572416464725c0a14961d7815df8cc96d27aa2c483f55c6c1636827757b026f2206616d6f756e744e000000609d749541220c7265636569766572416464725c0a14255b2782c26fc94cb85c0feddfdab6b8238db1e37b022400027b027b023a087b01220e5f6d61705370656e745574786f733b2240666132393031663136643863313931386536346637323734336537396637366230666630623038396131373835336262333062643564653265306231393564353b490c5c0a20a2f5dee8217ec36e0519c0c275591e5bfcd7134d1f2af79170c4baa19ac8f84f49105c0a201772cf45669b90169c63da13769ba4960ac4b539247aeb0d0c2d96e19ea74f2d49125c0a20f925a22f6378609ceaa1ec1aad299d79ae231e0df12b8773c9145b3f625e39023a063a0222125f6d6170436f6e63696c69756d4c6576656c3b49024904490049023a0422125f6d6170436f6e74726163745374617465733b2228336636616532633336663634323938306265623865336562653336393464313236396632353137646f22055f646174616f220c636f6e7472616374446174615f220c636f6e7472616374436f646522b3357b22637265617465436f6e63696c69756d223a223c286f626a436f6e63696c69756d29207b5c6e20202020202020206f626a436f6e63696c69756d2e5f63726561746f72203d2063616c6c6572416464726573733b5c6e5c6e202020202020202069662028746869732e5f70726f78794164647265737329207b5c6e20202020202020202020202072657475726e2061776169742064656c656761746563616c6c28746869732e5f70726f7879416464726573732c207b6d6574686f643a205c22637265617465436f6e63696c69756d5c222c20617272417267756d656e74733a205b6f626a436f6e63696c69756d5d7d293b5c6e20202020202020207d5c6e5c6e2020202020202020746869732e5f636865636b4665654372656174652876616c7565293b5c6e2020202020202020746869732e5f76616c6964617465436f6e63696c69756d286f626a436f6e63696c69756d293b5c6e5c6e2020202020202020746869732e5f617272436f6e63696c69756d732e70757368287b5c6e2020202020202020202020202e2e2e6f626a436f6e63696c69756d2c5c6e202020202020202020202020636f6e63696c69756d49643a20746869732e5f617272436f6e63696c69756d732e6c656e6774682c5c6e202020202020202020202020636f6e63696c69756d4372656174696f6e54783a20636f6e747261637454785c6e20202020202020207d293b5c6e202020207d222c226a6f696e436f6e63696c69756d223a223c28636f6e63696c69756d496429207b5c6e202020202020202069662028746869732e5f70726f78794164647265737329207b5c6e20202020202020202020202072657475726e2061776169742064656c656761746563616c6c28746869732e5f70726f7879416464726573732c207b6d6574686f643a205c226a6f696e436f6e63696c69756d5c222c20617272417267756d656e74733a205b636f6e63696c69756d49645d7d293b5c6e20202020202020207d5c6e5c6e2020202020202020636f6e7374206f626a436f6e63696c69756d203d20746869732e5f636865636b436f6e63696c69756d496428636f6e63696c69756d4964293b5c6e5c6e202020202020202069662028216f626a436f6e63696c69756d2e69734f70656e29207468726f77202827596f752063616e74206a6f696e207468697320636f6e63696c69756d2e2041736b2061626f757420696e7669746174696f6e27293b5c6e5c6e2020202020202020696620286f626a436f6e63696c69756d2e74797065203d3d3d203129207b5c6e202020202020202020202020746869732e5f616464506f73436f6e63696c69756d4d656d626572286f626a436f6e63696c69756d2c2063616c6c657241646472657373293b5c6e20202020202020207d20656c736520696620286f626a436f6e63696c69756d2e74797065203d3d3d203029207b5c6e202020202020202020202020746869732e5f6164645272436f6e63696c69756d4d656d626572286f626a436f6e63696c69756d2c2063616c6c657241646472657373293b5c6e20202020202020207d5c6e202020207d222c226c65617665436f6e63696c69756d223a223c28636f6e63696c69756d496429207b5c6e202020202020202069662028746869732e5f70726f78794164647265737329207b5c6e20202020202020202020202072657475726e2061776169742064656c656761746563616c6c28746869732e5f70726f7879416464726573732c207b6d6574686f643a205c226c65617665436f6e63696c69756d5c222c20617272417267756d656e74733a205b636f6e63696c69756d49645d7d293b5c6e20202020202020207d5c6e5c6e2020202020202020636f6e7374206f626a436f6e63696c69756d203d20746869732e5f636865636b436f6e63696c69756d496428636f6e63696c69756d4964293b5c6e5c6e2020202020202020696620286f626a436f6e63696c69756d2e74797065203d3d3d203129207b5c6e202020202020202020202020746869732e5f726574697265506f73436f6e63696c69756d4d656d626572286f626a436f6e63696c69756d2c2063616c6c657241646472657373293b5c6e20202020202020207d20656c736520696620286f626a436f6e63696c69756d2e74797065203d3d3d203029207b5c6e202020202020202020202020746869732e5f7265746972655272436f6e63696c69756d4d656d626572286f626a436f6e63696c69756d2c2063616c6c657241646472657373293b5c6e20202020202020207d5c6e202020207d222c22696e76697465546f436f6e63696c69756d223a223c28636f6e63696c69756d49642c2061727241646472657373657329207b5c6e202020202020202069662028746869732e5f70726f78794164647265737329207b5c6e20202020202020202020202072657475726e2061776169742064656c656761746563616c6c285c6e20202020202020202020202020202020746869732e5f70726f7879416464726573732c5c6e202020202020202020202020202020207b6d6574686f643a205c22696e76697465546f436f6e63696c69756d5c222c20617272417267756d656e74733a205b636f6e63696c69756d49642c206172724164647265737365735d7d5c6e202020202020202020202020293b5c6e20202020202020207d5c6e5c6e2020202020202020636f6e7374206f626a436f6e63696c69756d203d20746869732e5f636865636b436f6e63696c69756d496428636f6e63696c69756d4964293b5c6e2020202020202020746869732e5f636865636b43726561746f72286f626a436f6e63696c69756d2c2063616c6c657241646472657373293b5c6e5c6e2020202020202020696620286f626a436f6e63696c69756d2e69734f70656e29207468726f772028275468697320636f6e63696c69756d206973206f70656e2c206a757374206a6f696e20697427293b5c6e5c6e2020202020202020696620286f626a436f6e63696c69756d2e74797065203d3d3d203029207b5c6e2020202020202020202020207468726f7720282774686973206d6574686f64206f6e6c7920666f7220434f4e43494c49554d5f545950455f525227293b5c6e20202020202020207d5c6e5c6e2020202020202020746869732e5f6164645272436f6e63696c69756d4d656d626572286f626a436f6e63696c69756d2c2063616c6c657241646472657373293b5c6e202020207d222c22736574466565437265617465223a22286e4665654e657729207b5c6e2020202020202020746869732e5f636865636b4f776e657228293b5c6e2020202020202020746869732e5f666565437265617465203d206e4665654e65773b5c6e202020207d222c2273657450726f7879223a22287374724e65774164647265737329207b5c6e2020202020202020696620287374724e6577416464726573732e6c656e67746820213d3d20343029207468726f77202827426164206164647265737327293b5c6e5c6e2020202020202020746869732e5f636865636b4f776e657228293b5c6e2020202020202020746869732e5f70726f787941646472657373203d207374724e6577416464726573733b5c6e202020207d222c22676574486569676874546f52656c65617365223a223c28636f6e63696c69756d496429207b5c6e202020202020202069662028746869732e5f70726f78794164647265737329207b5c6e20202020202020202020202072657475726e2061776169742064656c656761746563616c6c28746869732e5f70726f7879416464726573732c207b6d6574686f643a205c22676574486569676874546f52656c656173655c222c20617272417267756d656e74733a205b636f6e63696c69756d49645d7d293b5c6e20202020202020207d5c6e5c6e2020202020202020636f6e7374206f626a436f6e63696c69756d203d20746869732e5f636865636b436f6e63696c69756d496428636f6e63696c69756d4964293b5c6e5c6e2020202020202020696620286f626a436f6e63696c69756d2e74797065203d3d3d203129207b5c6e2020202020202020202020207468726f7720282774686973206d6574686f64206f6e6c7920666f7220434f4e43494c49554d5f545950455f504f5327293b5c6e20202020202020207d5c6e5c6e202020202020202072657475726e20746869732e5f676574506f73486965676874546f52656c65617365286f626a436f6e63696c69756d2c2063616c6c657241646472657373293b5c6e202020207d222c226368616e6765436f6e63696c69756d506172616d6574657273223a223c286f626a4e6577506172616d657465727329207b5c6e202020202020202069662028746869732e5f70726f78794164647265737329207b5c6e20202020202020202020202072657475726e2061776169742064656c656761746563616c6c28746869732e5f70726f7879416464726573732c5c6e202020202020202020202020202020207b6d6574686f643a205c226368616e6765436f6e63696c69756d506172616d65746572735c222c20617272417267756d656e74733a205b6f626a4e6577506172616d65746572735d7d5c6e202020202020202020202020293b5c6e20202020202020207d5c6e20202020202020207468726f7728274e6f7420696d706c656d656e74652079657427293b5c6e202020207d222c225f706f73436f6e63696c69756d4d656d626572457869737473223a22286f626a436f6e63696c69756d2c2063616c6c65724164647265737329207b5c6e2020202020202020696620282141727261792e69734172726179286f626a436f6e63696c69756d2e6172724d656d626572732929206f626a436f6e63696c69756d2e6172724d656d62657273203d205b5d3b5c6e202020202020202072657475726e20216f626a436f6e63696c69756d2e6172724d656d626572732e6576657279286f626a457869737465644d656d626572203d3e206f626a457869737465644d656d6265722e6164647265737320213d3d2063616c6c657241646472657373293b5c6e202020207d222c225f616464506f73436f6e63696c69756d4d656d626572223a22286f626a436f6e63696c69756d29207b5c6e202020202020202069662028746869732e5f706f73436f6e63696c69756d4d656d626572457869737473286f626a436f6e63696c69756d2c2063616c6c6572416464726573732929207468726f77202827616c7265616479206a6f696e656427293b5c6e5c6e2020202020202020746869732e5f636865636b4465706f7369744a6f696e286f626a436f6e63696c69756d2c2076616c7565293b5c6e5c6e20202020202020206f626a436f6e63696c69756d2e6172724d656d626572732e70757368287b5c6e202020202020202020202020616464726573733a2063616c6c6572416464726573732c5c6e202020202020202020202020616d6f756e743a2076616c75652c5c6e2020202020202020202020206e486569676874546f52656c656173653a20626c6f636b2e686569676874202b35303030305c6e20202020202020207d293b5c6e202020207d222c225f726574697265506f73436f6e63696c69756d4d656d626572223a22286f626a436f6e63696c69756d2c2063616c6c65724164647265737329207b5c6e2020202020202020636f6e737420696478203d206f626a436f6e63696c69756d2e6172724d656d626572732e66696e64496e646578286d656d626572203d3e206d656d6265722e61646472657373203d3d3d2063616c6c657241646472657373293b5c6e202020202020202069662028217e69647829207468726f77202827596f75206172656e5c5c2774206d656d62657227293b5c6e5c6e2020202020202020636f6e7374206f626a4d656d626572203d206f626a436f6e63696c69756d2e6172724d656d626572735b6964785d3b5c6e2020202020202020696620286f626a4d656d6265722e6e486569676874546f52656c65617365203e20626c6f636b2e68656967687429207468726f77202827446f6e5c5c2774206c65617665207573206e6f7727293b5c6e5c6e202020202020202073656e64286f626a4d656d6265722e616464726573732c206f626a4d656d6265722e616d6f756e74293b5c6e20202020202020206f626a436f6e63696c69756d2e6172724d656d626572732e73706c696365286964782c2031293b5c6e202020207d222c225f636865636b4465706f7369744a6f696e223a22286f626a436f6e63696c69756d2c2076616c756529207b5c6e20202020202020206966202876616c7565203c206f626a436f6e63696c69756d2e6e4d696e416d6f756e74546f4a6f696e29207b5c6e2020202020202020202020207468726f77202827596f752073686f756c642073656e64206174206c656173742027202b206f626a436f6e63696c69756d2e6e4d696e416d6f756e74546f4a6f696e202b2027636f696e7327293b5c6e20202020202020207d5c6e202020207d222c225f676574506f73486965676874546f52656c65617365223a22286f626a436f6e63696c69756d2c2063616c6c65724164647265737329207b5c6e2020202020202020636f6e737420696478203d206f626a436f6e63696c69756d2e6172724d656d626572732e66696e64496e646578286d656d626572203d3e206d656d6265722e61646472657373203d3d3d2063616c6c657241646472657373293b5c6e202020202020202069662028217e69647829207468726f77202827596f75206172656e5c5c2774206d656d62657227293b5c6e5c6e2020202020202020636f6e7374206f626a4d656d626572203d206f626a436f6e63696c69756d2e6172724d656d626572735b6964785d3b5c6e202020202020202072657475726e206f626a4d656d6265722e6e486569676874546f52656c656173653b5c6e202020207d222c225f7252436f6e63696c69756d4d656d626572457869737473223a22286f626a436f6e63696c69756d2c2063616c6c65724164647265737329207b5c6e2020202020202020696620282141727261792e69734172726179286f626a436f6e63696c69756d2e6164647265737365732929206f626a436f6e63696c69756d2e616464726573736573203d205b5d3b5c6e202020202020202072657475726e20216f626a436f6e63696c69756d2e6164647265737365732e6576657279287374724d656d62657241646472203d3e207374724d656d6265724164647220213d3d2063616c6c657241646472657373293b5c6e202020207d222c225f6164645272436f6e63696c69756d4d656d626572223a22286f626a436f6e63696c69756d2c2063616c6c65724164647265737329207b5c6e202020202020202069662028746869732e5f7252436f6e63696c69756d4d656d626572457869737473286f626a436f6e63696c69756d2c2063616c6c6572416464726573732929207468726f77202827616c7265616479206a6f696e656427293b5c6e20202020202020206f626a436f6e63696c69756d2e6164647265737365732e707573682863616c6c657241646472657373293b5c6e202020207d222c225f7265746972655272436f6e63696c69756d4d656d626572223a22286f626a436f6e63696c69756d2c2063616c6c65724164647265737329207b5c6e2020202020202020636f6e737420696478203d206f626a436f6e63696c69756d2e6164647265737365732e66696e64496e6465782861646472203d3e2061646472203d3d3d2063616c6c657241646472657373293b5c6e202020202020202069662028217e69647829207468726f77202827596f75206172656e5c5c2774206d656d62657227293b5c6e20202020202020206f626a436f6e63696c69756d2e6164647265737365732e73706c696365286964782c2031293b5c6e202020207d222c225f636865636b436f6e63696c69756d4964223a2228636f6e63696c69756d496429207b5c6e202020202020202069662028636f6e63696c69756d4964203e20746869732e5f617272436f6e63696c69756d732e6c656e677468207c7c20636f6e63696c69756d4964203c203029207468726f7720282742616420636f6e63696c69756d496427293b5c6e202020202020202072657475726e20746869732e5f617272436f6e63696c69756d735b636f6e63696c69756d49645d3b5c6e202020207d222c225f636865636b466565437265617465223a22286e46656529207b5c6e20202020202020206966202821746869732e5f66656543726561746529207468726f77202827536574205f66656543726561746520666972737427293b5c6e202020202020202069662028746869732e5f666565437265617465203e206e46656529207468726f772028274e6f7420656e6f7567682066756e647327293b5c6e202020207d222c225f636865636b43726561746f72223a22286f626a436f6e63696c69756d2c2063616c6c65724164647265737329207b5c6e2020202020202020696620286f626a436f6e63696c69756d2e5f63726561746f7220213d3d2063616c6c65724164647265737329207468726f77202827556e617574686f72697a65642063616c6c27293b5c6e202020207d222c225f76616c6964617465436f6e63696c69756d223a22286f626a436f6e63696c69756d29207b5c6e2020202020202020696620286f626a436f6e63696c69756d2e74797065203d3d3d203129207b5c6e202020202020202020202020696620282141727261792e69734172726179286f626a436f6e63696c69756d2e6172724d656d626572732929206f626a436f6e63696c69756d2e6172724d656d62657273203d205b5d3b5c6e5c6e20202020202020202020202069662028216f626a436f6e63696c69756d2e6e4d696e416d6f756e74546f4a6f696e207c7c206f626a436f6e63696c69756d2e6e4d696e416d6f756e74546f4a6f696e203c203029207468726f7720282753706563696679206e4d696e416d6f756e74546f4a6f696e27293b5c6e5c6e202020202020202020202020636f6e737420696e697469616c416d6f756e74203d206f626a436f6e63696c69756d2e6172724d656d626572732e7265647563652828616363756d2c206f626a4d656d62657229203d3e20616363756d202b206f626a4d656d6265722e616d6f756e742c2030293b5c6e20202020202020202020202069662028746869732e5f666565437265617465202b20696e697469616c416d6f756e74203e2076616c756529207468726f772028274e6f7420656e6f75676820636f696e7320776572652073656e7420636f20637265617465207375636820636f6e63696c69756d27293b5c6e20202020202020207d5c6e202020207d227d220b636f6e63696c69756d49644900220762616c616e63654e00000000ca1353417b0422095f6461746153697a6549860a220d5f636f6e7472616374446174616f220e5f617272436f6e63696c69756d73610249006f220961646472657373657361014900222830663935626665616365306534666631326137333832353636386432313336656338646663643763400101220b636f6e63696c69756d49644900220671756f72756d4902220a706172616d65746572736f2204666565736f7b0022096973456e61626c6564547b0222047479706549002213636f6e63696c69756d4372656174696f6e54782240353934343132353534373763396465336162313664306139363934383033396265373530316138376233643364383031393737386365383364383134393761647b0649026f220b636f6e63696c69756d4964490222106e4d696e416d6f756e74546f4a6f696e49d00f220669734f70656e54220a6172724d656d62657273610249006f2207616464726573732228323535623237383263323666633934636238356330666564646664616236623832333864623165332206616d6f756e74498092f40122106e486569676874546f52656c6561736549a68d067b0349026f2207616464726573732228323636646133313032333636356333633061313439356533613131343639383865653765383063642206616d6f756e74498092f40122106e486569676874546f52656c6561736549aa8d067b03400202220a706172616d65746572736f2204666565736f7b0022096973456e61626c6564547b0222047479706549022213636f6e63696c69756d4372656174696f6e54782240663233616162626539346266303539323632326364343438343832303733636263323638396436376138366332623431623132393834653039656463333531657b07400202220a5f6665654372656174654980897a7b02220b5f737472416464726573732228336636616532633336663634323938306265623865336562653336393464313236396632353137647b043a02220e5f6d6170547852656365697074733b2240313737326366343536363962393031363963363364613133373639626134393630616334623533393234376165623064306332643936653139656137346632646f22055f646174616f220c696e7465726e616c54786e7341002400002205636f696e7341002400002209636f696e73557365644e000000008014c740220673746174757349027b047b013a0222065f6e6f6e636549007b06'
        );
        const patchToApply = factory.PatchDB.deserialize(
            'ff0d6f22055f646174616f2205636f696e733b2240666132393031663136643863313931386536346637323734336537396637366230666630623038396131373835336262333062643564653265306231393564356f22075f74784861736822406661323930316631366438633139313865363466373237343365373966373662306666306230383961313738353362623330626435646532653062313935643522055f646174616f220a617272496e646578657341084900490249044906490e491249144916240008220a6172724f75747075747341086f2206616d6f756e744e0000000084d79741220c7265636569766572416464725c0a140f95bfeace0e4ff12a73825668d2136ec8dfcd7c7b026f2206616d6f756e744e0000000084d79741220c7265636569766572416464725c0a140f95bfeace0e4ff12a73825668d2136ec8dfcd7c7b026f2206616d6f756e744e0000000084d79741220c7265636569766572416464725c0a140f95bfeace0e4ff12a73825668d2136ec8dfcd7c7b026f2206616d6f756e744e0000000084d79741220c7265636569766572416464725c0a140f95bfeace0e4ff12a73825668d2136ec8dfcd7c7b026f2206616d6f756e744e0000000084d79741220c7265636569766572416464725c0a14255b2782c26fc94cb85c0feddfdab6b8238db1e37b026f2206616d6f756e744e0000000084d79741220c7265636569766572416464725c0a14266da31023665c3c0a1495e3a1146988ee7e80cd7b026f2206616d6f756e744e0000000084d79741220c7265636569766572416464725c0a14266da31023665c3c0a1495e3a1146988ee7e80cd7b026f2206616d6f756e744e0000000084d79741220c7265636569766572416464725c0a14266da31023665c3c0a1495e3a1146988ee7e80cd7b022400087b027b022240626562383365333839396239626538313439656565333630353131643834326634663362356636333135613635653433366237326438313661303863333334656f22075f74784861736822406265623833653338393962396265383134396565653336303531316438343266346633623566363331356136356534333662373264383136613038633333346522055f646174616f220a617272496e6465786573410249004902240002220a6172724f75747075747341026f2206616d6f756e744e00000060c3126341220c7265636569766572416464725c0a14961d7815df8cc96d27aa2c483f55c6c1636827757b026f2206616d6f756e744e000000d81b759541220c7265636569766572416464725c0a140f95bfeace0e4ff12a73825668d2136ec8dfcd7c7b022400027b027b023a047b01220e5f6d61705370656e745574786f733b2240666132393031663136643863313931386536346637323734336537396637366230666630623038396131373835336262333062643564653265306231393564353b490c5c0a20a2f5dee8217ec36e0519c0c275591e5bfcd7134d1f2af79170c4baa19ac8f84f49105c0a201772cf45669b90169c63da13769ba4960ac4b539247aeb0d0c2d96e19ea74f2d3a043a0222125f6d6170436f6e63696c69756d4c6576656c3b49024902490049023a0422125f6d6170436f6e74726163745374617465733b2228336636616532633336663634323938306265623865336562653336393464313236396632353137646f22055f646174616f220c636f6e7472616374446174615f220c636f6e7472616374436f646522b3357b22637265617465436f6e63696c69756d223a223c286f626a436f6e63696c69756d29207b5c6e20202020202020206f626a436f6e63696c69756d2e5f63726561746f72203d2063616c6c6572416464726573733b5c6e5c6e202020202020202069662028746869732e5f70726f78794164647265737329207b5c6e20202020202020202020202072657475726e2061776169742064656c656761746563616c6c28746869732e5f70726f7879416464726573732c207b6d6574686f643a205c22637265617465436f6e63696c69756d5c222c20617272417267756d656e74733a205b6f626a436f6e63696c69756d5d7d293b5c6e20202020202020207d5c6e5c6e2020202020202020746869732e5f636865636b4665654372656174652876616c7565293b5c6e2020202020202020746869732e5f76616c6964617465436f6e63696c69756d286f626a436f6e63696c69756d293b5c6e5c6e2020202020202020746869732e5f617272436f6e63696c69756d732e70757368287b5c6e2020202020202020202020202e2e2e6f626a436f6e63696c69756d2c5c6e202020202020202020202020636f6e63696c69756d49643a20746869732e5f617272436f6e63696c69756d732e6c656e6774682c5c6e202020202020202020202020636f6e63696c69756d4372656174696f6e54783a20636f6e747261637454785c6e20202020202020207d293b5c6e202020207d222c226a6f696e436f6e63696c69756d223a223c28636f6e63696c69756d496429207b5c6e202020202020202069662028746869732e5f70726f78794164647265737329207b5c6e20202020202020202020202072657475726e2061776169742064656c656761746563616c6c28746869732e5f70726f7879416464726573732c207b6d6574686f643a205c226a6f696e436f6e63696c69756d5c222c20617272417267756d656e74733a205b636f6e63696c69756d49645d7d293b5c6e20202020202020207d5c6e5c6e2020202020202020636f6e7374206f626a436f6e63696c69756d203d20746869732e5f636865636b436f6e63696c69756d496428636f6e63696c69756d4964293b5c6e5c6e202020202020202069662028216f626a436f6e63696c69756d2e69734f70656e29207468726f77202827596f752063616e74206a6f696e207468697320636f6e63696c69756d2e2041736b2061626f757420696e7669746174696f6e27293b5c6e5c6e2020202020202020696620286f626a436f6e63696c69756d2e74797065203d3d3d203129207b5c6e202020202020202020202020746869732e5f616464506f73436f6e63696c69756d4d656d626572286f626a436f6e63696c69756d2c2063616c6c657241646472657373293b5c6e20202020202020207d20656c736520696620286f626a436f6e63696c69756d2e74797065203d3d3d203029207b5c6e202020202020202020202020746869732e5f6164645272436f6e63696c69756d4d656d626572286f626a436f6e63696c69756d2c2063616c6c657241646472657373293b5c6e20202020202020207d5c6e202020207d222c226c65617665436f6e63696c69756d223a223c28636f6e63696c69756d496429207b5c6e202020202020202069662028746869732e5f70726f78794164647265737329207b5c6e20202020202020202020202072657475726e2061776169742064656c656761746563616c6c28746869732e5f70726f7879416464726573732c207b6d6574686f643a205c226c65617665436f6e63696c69756d5c222c20617272417267756d656e74733a205b636f6e63696c69756d49645d7d293b5c6e20202020202020207d5c6e5c6e2020202020202020636f6e7374206f626a436f6e63696c69756d203d20746869732e5f636865636b436f6e63696c69756d496428636f6e63696c69756d4964293b5c6e5c6e2020202020202020696620286f626a436f6e63696c69756d2e74797065203d3d3d203129207b5c6e202020202020202020202020746869732e5f726574697265506f73436f6e63696c69756d4d656d626572286f626a436f6e63696c69756d2c2063616c6c657241646472657373293b5c6e20202020202020207d20656c736520696620286f626a436f6e63696c69756d2e74797065203d3d3d203029207b5c6e202020202020202020202020746869732e5f7265746972655272436f6e63696c69756d4d656d626572286f626a436f6e63696c69756d2c2063616c6c657241646472657373293b5c6e20202020202020207d5c6e202020207d222c22696e76697465546f436f6e63696c69756d223a223c28636f6e63696c69756d49642c2061727241646472657373657329207b5c6e202020202020202069662028746869732e5f70726f78794164647265737329207b5c6e20202020202020202020202072657475726e2061776169742064656c656761746563616c6c285c6e20202020202020202020202020202020746869732e5f70726f7879416464726573732c5c6e202020202020202020202020202020207b6d6574686f643a205c22696e76697465546f436f6e63696c69756d5c222c20617272417267756d656e74733a205b636f6e63696c69756d49642c206172724164647265737365735d7d5c6e202020202020202020202020293b5c6e20202020202020207d5c6e5c6e2020202020202020636f6e7374206f626a436f6e63696c69756d203d20746869732e5f636865636b436f6e63696c69756d496428636f6e63696c69756d4964293b5c6e2020202020202020746869732e5f636865636b43726561746f72286f626a436f6e63696c69756d2c2063616c6c657241646472657373293b5c6e5c6e2020202020202020696620286f626a436f6e63696c69756d2e69734f70656e29207468726f772028275468697320636f6e63696c69756d206973206f70656e2c206a757374206a6f696e20697427293b5c6e5c6e2020202020202020696620286f626a436f6e63696c69756d2e74797065203d3d3d203029207b5c6e2020202020202020202020207468726f7720282774686973206d6574686f64206f6e6c7920666f7220434f4e43494c49554d5f545950455f525227293b5c6e20202020202020207d5c6e5c6e2020202020202020746869732e5f6164645272436f6e63696c69756d4d656d626572286f626a436f6e63696c69756d2c2063616c6c657241646472657373293b5c6e202020207d222c22736574466565437265617465223a22286e4665654e657729207b5c6e2020202020202020746869732e5f636865636b4f776e657228293b5c6e2020202020202020746869732e5f666565437265617465203d206e4665654e65773b5c6e202020207d222c2273657450726f7879223a22287374724e65774164647265737329207b5c6e2020202020202020696620287374724e6577416464726573732e6c656e67746820213d3d20343029207468726f77202827426164206164647265737327293b5c6e5c6e2020202020202020746869732e5f636865636b4f776e657228293b5c6e2020202020202020746869732e5f70726f787941646472657373203d207374724e6577416464726573733b5c6e202020207d222c22676574486569676874546f52656c65617365223a223c28636f6e63696c69756d496429207b5c6e202020202020202069662028746869732e5f70726f78794164647265737329207b5c6e20202020202020202020202072657475726e2061776169742064656c656761746563616c6c28746869732e5f70726f7879416464726573732c207b6d6574686f643a205c22676574486569676874546f52656c656173655c222c20617272417267756d656e74733a205b636f6e63696c69756d49645d7d293b5c6e20202020202020207d5c6e5c6e2020202020202020636f6e7374206f626a436f6e63696c69756d203d20746869732e5f636865636b436f6e63696c69756d496428636f6e63696c69756d4964293b5c6e5c6e2020202020202020696620286f626a436f6e63696c69756d2e74797065203d3d3d203129207b5c6e2020202020202020202020207468726f7720282774686973206d6574686f64206f6e6c7920666f7220434f4e43494c49554d5f545950455f504f5327293b5c6e20202020202020207d5c6e5c6e202020202020202072657475726e20746869732e5f676574506f73486965676874546f52656c65617365286f626a436f6e63696c69756d2c2063616c6c657241646472657373293b5c6e202020207d222c226368616e6765436f6e63696c69756d506172616d6574657273223a223c286f626a4e6577506172616d657465727329207b5c6e202020202020202069662028746869732e5f70726f78794164647265737329207b5c6e20202020202020202020202072657475726e2061776169742064656c656761746563616c6c28746869732e5f70726f7879416464726573732c5c6e202020202020202020202020202020207b6d6574686f643a205c226368616e6765436f6e63696c69756d506172616d65746572735c222c20617272417267756d656e74733a205b6f626a4e6577506172616d65746572735d7d5c6e202020202020202020202020293b5c6e20202020202020207d5c6e20202020202020207468726f7728274e6f7420696d706c656d656e74652079657427293b5c6e202020207d222c225f706f73436f6e63696c69756d4d656d626572457869737473223a22286f626a436f6e63696c69756d2c2063616c6c65724164647265737329207b5c6e2020202020202020696620282141727261792e69734172726179286f626a436f6e63696c69756d2e6172724d656d626572732929206f626a436f6e63696c69756d2e6172724d656d62657273203d205b5d3b5c6e202020202020202072657475726e20216f626a436f6e63696c69756d2e6172724d656d626572732e6576657279286f626a457869737465644d656d626572203d3e206f626a457869737465644d656d6265722e6164647265737320213d3d2063616c6c657241646472657373293b5c6e202020207d222c225f616464506f73436f6e63696c69756d4d656d626572223a22286f626a436f6e63696c69756d29207b5c6e202020202020202069662028746869732e5f706f73436f6e63696c69756d4d656d626572457869737473286f626a436f6e63696c69756d2c2063616c6c6572416464726573732929207468726f77202827616c7265616479206a6f696e656427293b5c6e5c6e2020202020202020746869732e5f636865636b4465706f7369744a6f696e286f626a436f6e63696c69756d2c2076616c7565293b5c6e5c6e20202020202020206f626a436f6e63696c69756d2e6172724d656d626572732e70757368287b5c6e202020202020202020202020616464726573733a2063616c6c6572416464726573732c5c6e202020202020202020202020616d6f756e743a2076616c75652c5c6e2020202020202020202020206e486569676874546f52656c656173653a20626c6f636b2e686569676874202b35303030305c6e20202020202020207d293b5c6e202020207d222c225f726574697265506f73436f6e63696c69756d4d656d626572223a22286f626a436f6e63696c69756d2c2063616c6c65724164647265737329207b5c6e2020202020202020636f6e737420696478203d206f626a436f6e63696c69756d2e6172724d656d626572732e66696e64496e646578286d656d626572203d3e206d656d6265722e61646472657373203d3d3d2063616c6c657241646472657373293b5c6e202020202020202069662028217e69647829207468726f77202827596f75206172656e5c5c2774206d656d62657227293b5c6e5c6e2020202020202020636f6e7374206f626a4d656d626572203d206f626a436f6e63696c69756d2e6172724d656d626572735b6964785d3b5c6e2020202020202020696620286f626a4d656d6265722e6e486569676874546f52656c65617365203e20626c6f636b2e68656967687429207468726f77202827446f6e5c5c2774206c65617665207573206e6f7727293b5c6e5c6e202020202020202073656e64286f626a4d656d6265722e616464726573732c206f626a4d656d6265722e616d6f756e74293b5c6e20202020202020206f626a436f6e63696c69756d2e6172724d656d626572732e73706c696365286964782c2031293b5c6e202020207d222c225f636865636b4465706f7369744a6f696e223a22286f626a436f6e63696c69756d2c2076616c756529207b5c6e20202020202020206966202876616c7565203c206f626a436f6e63696c69756d2e6e4d696e416d6f756e74546f4a6f696e29207b5c6e2020202020202020202020207468726f77202827596f752073686f756c642073656e64206174206c656173742027202b206f626a436f6e63696c69756d2e6e4d696e416d6f756e74546f4a6f696e202b2027636f696e7327293b5c6e20202020202020207d5c6e202020207d222c225f676574506f73486965676874546f52656c65617365223a22286f626a436f6e63696c69756d2c2063616c6c65724164647265737329207b5c6e2020202020202020636f6e737420696478203d206f626a436f6e63696c69756d2e6172724d656d626572732e66696e64496e646578286d656d626572203d3e206d656d6265722e61646472657373203d3d3d2063616c6c657241646472657373293b5c6e202020202020202069662028217e69647829207468726f77202827596f75206172656e5c5c2774206d656d62657227293b5c6e5c6e2020202020202020636f6e7374206f626a4d656d626572203d206f626a436f6e63696c69756d2e6172724d656d626572735b6964785d3b5c6e202020202020202072657475726e206f626a4d656d6265722e6e486569676874546f52656c656173653b5c6e202020207d222c225f7252436f6e63696c69756d4d656d626572457869737473223a22286f626a436f6e63696c69756d2c2063616c6c65724164647265737329207b5c6e2020202020202020696620282141727261792e69734172726179286f626a436f6e63696c69756d2e6164647265737365732929206f626a436f6e63696c69756d2e616464726573736573203d205b5d3b5c6e202020202020202072657475726e20216f626a436f6e63696c69756d2e6164647265737365732e6576657279287374724d656d62657241646472203d3e207374724d656d6265724164647220213d3d2063616c6c657241646472657373293b5c6e202020207d222c225f6164645272436f6e63696c69756d4d656d626572223a22286f626a436f6e63696c69756d2c2063616c6c65724164647265737329207b5c6e202020202020202069662028746869732e5f7252436f6e63696c69756d4d656d626572457869737473286f626a436f6e63696c69756d2c2063616c6c6572416464726573732929207468726f77202827616c7265616479206a6f696e656427293b5c6e20202020202020206f626a436f6e63696c69756d2e6164647265737365732e707573682863616c6c657241646472657373293b5c6e202020207d222c225f7265746972655272436f6e63696c69756d4d656d626572223a22286f626a436f6e63696c69756d2c2063616c6c65724164647265737329207b5c6e2020202020202020636f6e737420696478203d206f626a436f6e63696c69756d2e6164647265737365732e66696e64496e6465782861646472203d3e2061646472203d3d3d2063616c6c657241646472657373293b5c6e202020202020202069662028217e69647829207468726f77202827596f75206172656e5c5c2774206d656d62657227293b5c6e20202020202020206f626a436f6e63696c69756d2e6164647265737365732e73706c696365286964782c2031293b5c6e202020207d222c225f636865636b436f6e63696c69756d4964223a2228636f6e63696c69756d496429207b5c6e202020202020202069662028636f6e63696c69756d4964203e20746869732e5f617272436f6e63696c69756d732e6c656e677468207c7c20636f6e63696c69756d4964203c203029207468726f7720282742616420636f6e63696c69756d496427293b5c6e202020202020202072657475726e20746869732e5f617272436f6e63696c69756d735b636f6e63696c69756d49645d3b5c6e202020207d222c225f636865636b466565437265617465223a22286e46656529207b5c6e20202020202020206966202821746869732e5f66656543726561746529207468726f77202827536574205f66656543726561746520666972737427293b5c6e202020202020202069662028746869732e5f666565437265617465203e206e46656529207468726f772028274e6f7420656e6f7567682066756e647327293b5c6e202020207d222c225f636865636b43726561746f72223a22286f626a436f6e63696c69756d2c2063616c6c65724164647265737329207b5c6e2020202020202020696620286f626a436f6e63696c69756d2e5f63726561746f7220213d3d2063616c6c65724164647265737329207468726f77202827556e617574686f72697a65642063616c6c27293b5c6e202020207d222c225f76616c6964617465436f6e63696c69756d223a22286f626a436f6e63696c69756d29207b5c6e2020202020202020696620286f626a436f6e63696c69756d2e74797065203d3d3d203129207b5c6e202020202020202020202020696620282141727261792e69734172726179286f626a436f6e63696c69756d2e6172724d656d626572732929206f626a436f6e63696c69756d2e6172724d656d62657273203d205b5d3b5c6e5c6e20202020202020202020202069662028216f626a436f6e63696c69756d2e6e4d696e416d6f756e74546f4a6f696e207c7c206f626a436f6e63696c69756d2e6e4d696e416d6f756e74546f4a6f696e203c203029207468726f7720282753706563696679206e4d696e416d6f756e74546f4a6f696e27293b5c6e5c6e202020202020202020202020636f6e737420696e697469616c416d6f756e74203d206f626a436f6e63696c69756d2e6172724d656d626572732e7265647563652828616363756d2c206f626a4d656d62657229203d3e20616363756d202b206f626a4d656d6265722e616d6f756e742c2030293b5c6e20202020202020202020202069662028746869732e5f666565437265617465202b20696e697469616c416d6f756e74203e2076616c756529207468726f772028274e6f7420656e6f75676820636f696e7320776572652073656e7420636f20637265617465207375636820636f6e63696c69756d27293b5c6e20202020202020207d5c6e202020207d227d220b636f6e63696c69756d49644900220762616c616e63654e00000000ca1353417b0422095f6461746153697a6549860a220d5f636f6e7472616374446174616f220e5f617272436f6e63696c69756d73610249006f220961646472657373657361014900222830663935626665616365306534666631326137333832353636386432313336656338646663643763400101220b636f6e63696c69756d49644900220671756f72756d4902220a706172616d65746572736f2204666565736f7b0022096973456e61626c6564547b0222047479706549002213636f6e63696c69756d4372656174696f6e54782240353934343132353534373763396465336162313664306139363934383033396265373530316138376233643364383031393737386365383364383134393761647b0649026f220b636f6e63696c69756d4964490222106e4d696e416d6f756e74546f4a6f696e49d00f220669734f70656e54220a6172724d656d62657273610249006f2207616464726573732228323535623237383263323666633934636238356330666564646664616236623832333864623165332206616d6f756e74498092f40122106e486569676874546f52656c6561736549a68d067b0349026f2207616464726573732228323636646133313032333636356333633061313439356533613131343639383865653765383063642206616d6f756e74498092f40122106e486569676874546f52656c6561736549aa8d067b03400202220a706172616d65746572736f2204666565736f7b0022096973456e61626c6564547b0222047479706549022213636f6e63696c69756d4372656174696f6e54782240663233616162626539346266303539323632326364343438343832303733636263323638396436376138366332623431623132393834653039656463333531657b07400202220a5f6665654372656174654980897a7b02220b5f737472416464726573732228336636616532633336663634323938306265623865336562653336393464313236396632353137647b043a02220e5f6d6170547852656365697074733b2240313737326366343536363962393031363963363364613133373639626134393630616334623533393234376165623064306332643936653139656137346632646f22055f646174616f220c696e7465726e616c54786e7341002400002205636f696e7341002400002209636f696e73557365644e000000008014c740220673746174757349027b047b013a0222065f6e6f6e636549007b06'
        );

        patchTip.merge(patchToApply);
        patchToApply.merge(patchTip);
    });

    it('should check contract data separation', async () => {
        const contractAddr = generateAddress().toString('hex');

        const patch = new factory.PatchDB(0);
        const contract1 = new factory.Contract({contractData: {value: 1}, conciliumId: 0});
        contract1.storeAddress(contractAddr);
        patch.setContract(contract1);

        {
            const patchDerived = patch.merge(new factory.PatchDB());
            const contract2 = patchDerived.getContract(contractAddr);
            contract2.getData().value = 12;

            const contract = patch.getContract(contractAddr);
            assert.equal(contract.getData().value, 1);
        }

        {
            const patchDerived = new factory.PatchDB().merge(patch);
            const contract2 = patchDerived.getContract(contractAddr);
            contract2.getData().value = 12;

            const contract = patch.getContract(contractAddr);
            assert.equal(contract.getData().value, 1);
        }
    });

    it('should PURGE contract data (unchanged between blocks)', async () => {
        const contractAddr = generateAddress().toString('hex');

        const patch = new factory.PatchDB(0);
        const contract = new factory.Contract({contractData: {value: 1}, conciliumId: 0});
        contract.storeAddress(contractAddr);
        patch.setContract(contract);

        const patchDerived = patch.merge(new factory.PatchDB());
        patchDerived.setConciliumId(1);
        patchDerived.purge(patch);

        assert.isNotOk(patchDerived.getContract(contractAddr));
    });

    it('should KEEP contract data (since data was changed)', async () => {
        const contractAddr = generateAddress().toString('hex');

        const patch = new factory.PatchDB(0);
        const contract = new factory.Contract({contractData: {value: 1}, conciliumId: 0});
        contract.storeAddress(contractAddr);
        patch.setContract(contract);

        const patchDerived = patch.merge(new factory.PatchDB());
        patchDerived.setConciliumId(0);

        const contract2 = new factory.Contract({contractData: {value: 2}, conciliumId: 0});
        contract2.storeAddress(contractAddr);
        patchDerived.setContract(contract2);
        patchDerived.purge(patch);

        assert.isOk(patchDerived.getContract(contractAddr));
    });

    it('should FAIL _validateAgainstStable (spend already spended stable index)', async () => {
        const utxo = createUtxo([0, 1, 2, 3, 4]);

        // store in patchStable UTXO with 0 index spent
        const utxoClone = utxo.clone();
        utxoClone.spendCoins(0);
        const patchStable = new factory.PatchDB(0);
        patchStable.setUtxo(utxoClone);

        // spend index 0 in pending blocks
        const patch = new factory.PatchDB(0);
        patch.spendCoins(utxo, 0, pseudoRandomBuffer());

        assert.throws(() => patch.validateAgainstStable(patchStable));
    });

    it('should PASS _validateAgainstStable (spend stable index)', async () => {
        const utxo = createUtxo([0, 1, 2, 3, 4]);

        const patchStable = new factory.PatchDB(0);
        patchStable.setUtxo(utxo);

        // spend index 0 in pending blocks
        const patch = new factory.PatchDB(0);
        patch.spendCoins(utxo, 0, pseudoRandomBuffer());

        patch.validateAgainstStable(patchStable);
    });

    it('should PASS _validateAgainstStable (empty stable patch)', async () => {
        const patchStable = new factory.PatchDB(0);

        // spend index 0 in pending blocks
        const utxo = createUtxo([0, 1, 2, 3, 4]);
        const patch = new factory.PatchDB(0);
        patch.spendCoins(utxo, 0, pseudoRandomBuffer());

        patch.validateAgainstStable(patchStable);
    });

    it('should PASS _validateAgainstStable (not found in stable patch)', async () => {
        const utxo = createUtxo([0, 1, 2, 3, 4]);
        const utxo2 = createUtxo([0, 1, 2, 3, 4]);

        // stable has different TX
        const patchStable = new factory.PatchDB(0);
        patchStable.setUtxo(utxo2);

        // spend index 0 in pending blocks
        const patch = new factory.PatchDB(0);
        patch.spendCoins(utxo, 0, pseudoRandomBuffer());

        patch.validateAgainstStable(patchStable);
    });

    it('should increment nonce', async () => {
        const patch = new factory.PatchDB(0);
        assert.equal(patch.getNonce(), 0);
        assert.equal(patch.getNonce(), 1);
        assert.equal(patch.getNonce(), 2);
    });

    describe('setReceipt', () => {
        it('should save receipt to patch', async () => {
            const patch = new factory.PatchDB(0);
            const txHash = pseudoRandomBuffer().toString('hex');
            patch.setReceipt(txHash, new factory.TxReceipt({}));

            assert.equal(Array.from(patch.getReceipts()).length, 1);
        });

        it('should MERGE patches with RECEIPTS', async () => {
            const patch = new factory.PatchDB(0);
            const patch2 = new factory.PatchDB(1);

            {
                const txHash = pseudoRandomBuffer().toString('hex');
                patch.setReceipt(txHash, new factory.TxReceipt({}));
                patch2.setReceipt(txHash, new factory.TxReceipt({}));
            }

            {
                const txHash = pseudoRandomBuffer().toString('hex');
                patch2.setReceipt(txHash, new factory.TxReceipt({}));
            }

            // now patches has one intersection
            const mergedPatch = patch.merge(patch2);
            assert.equal(Array.from(mergedPatch.getReceipts()).length, 2);
        });

        it('should PURGE patches with RECEIPTS', async () => {
            const patch = new factory.PatchDB(0);
            const patch2 = new factory.PatchDB(0);

            {
                const txHash = pseudoRandomBuffer().toString('hex');
                patch.setReceipt(txHash, new factory.TxReceipt({}));
                patch2.setReceipt(txHash, new factory.TxReceipt({}));
            }

            {
                const txHash = pseudoRandomBuffer().toString('hex');
                patch2.setReceipt(txHash, new factory.TxReceipt({}));
            }

            // now patches has one intersection
            patch2.purge(patch);
            assert.equal(Array.from(patch2.getReceipts()).length, 1);
        });

        it('should THROW', async () => {
            const patch = new factory.PatchDB();
            const strTxHash = pseudoRandomBuffer().toString('hex');

            patch.setReceipt(strTxHash, new factory.TxReceipt({status: factory.Constants.TX_STATUS_FAILED}));
            assert.throws(
                () => patch.setReceipt(strTxHash, new factory.TxReceipt({status: factory.Constants.TX_STATUS_OK}))
            );
        });

        it('should add internal Tx hash stored receipt', async () => {
            const patch = new factory.PatchDB();
            const strTxHash = pseudoRandomBuffer().toString('hex');

            const receipt1 = new factory.TxReceipt({status: factory.Constants.TX_STATUS_OK});
            receipt1.addInternalUtxo(createInternalUtxo());
            receipt1.addInternalUtxo(createInternalUtxo());

            patch.setReceipt(strTxHash, receipt1);

            {
                const arrReceipts = [...patch.getReceipts()];
                assert.equal(arrReceipts.length, 1);
                const [, receipt] = arrReceipts[0];
                assert.equal(receipt.getInternalTxns().length, 2);
            }

            const receipt2 = new factory.TxReceipt({status: factory.Constants.TX_STATUS_OK});
            receipt2.addInternalUtxo(createInternalUtxo());
            receipt2.addInternalUtxo(createInternalUtxo());

            patch.setReceipt(strTxHash, receipt2);

            {
                const arrReceipts = [...patch.getReceipts()];
                assert.equal(arrReceipts.length, 1);
                const [, receipt] = arrReceipts[0];
                assert.equal(receipt.getInternalTxns().length, 4);
            }
        });
    });
});
