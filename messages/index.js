const MsgCommonWrapper = require('./msgCommon');

const MsgAddrWrapper = require('./node/msgAddr');
const MsgVersionWrapper = require('./node/msgVersion');
const MsgRejectWrapper = require('./node/msgReject');
const MsgBlockWrapper = require('./node/msgBlock');
const MsgTxWrapper = require('./node/msgTx');
const MsgInvWrapper = require('./node/msgInv');
const MsgGetDataWrapper = require('./node/msgGetData');

const PeerInfoWrapper = require('./includes/peerInfo');

const MsgWitnessCommonWrapper = require('./witness/msgWitnessCommon.js');
const MsgWitnessNextRoundWrapper = require('./witness/msgWitnessNextRound.js');
const MsgWitnessExposeWrapper = require('./witness/msgWitnessExpose.js');
const MsgWitnessBlockWrapper = require('./witness/msgWitnessBlock.js');
const MsgWitnessBlockAckWrapper = require('./witness/msgWitnessBlockAck.js');

module.exports = (factory, objPrototypes) => {

    const {Constants, Crypto, Block, Transaction, Inventory} = factory;
    const {messageProto, versionPayloadProto, addrPayloadProto, rejectPayloadProto} = objPrototypes;
    const {witnessMessageProto, witnessNextRoundProto, witnessBlockAckProto} = objPrototypes;
    const {peerInfoProto} = objPrototypes;

    const MsgCommon = MsgCommonWrapper(Constants, Crypto, messageProto);
    const MsgWitnessCommon = MsgWitnessCommonWrapper(Constants, Crypto, MsgCommon, witnessMessageProto);
    const MsgBlock = MsgBlockWrapper(Constants, Crypto, MsgCommon, Block);
    const MsgInv = MsgInvWrapper(Constants, Crypto, MsgCommon, Inventory);

    return {
        MsgCommon,
        MsgVersion: MsgVersionWrapper(Constants, MsgCommon, versionPayloadProto),
        MsgAddr: MsgAddrWrapper(Constants, MsgCommon, addrPayloadProto),
        MsgReject: MsgRejectWrapper(Constants, MsgCommon, rejectPayloadProto),
        MsgBlock,
        MsgTx: MsgTxWrapper(Constants, Crypto, MsgCommon, Transaction),
        MsgInv,
        MsgGetData: MsgGetDataWrapper(Constants, Crypto, MsgInv),

        PeerInfo: PeerInfoWrapper(Constants, peerInfoProto),

        MsgWitnessCommon,
        MsgWitnessNextRound: MsgWitnessNextRoundWrapper(Constants, Crypto, MsgWitnessCommon, witnessNextRoundProto),
        MsgWitnessWitnessExpose: MsgWitnessExposeWrapper(Constants, Crypto, MsgWitnessCommon),
        MsgWitnessBlock: MsgWitnessBlockWrapper(Constants, MsgWitnessCommon, Block),
        MsgWitnessBlockAck: MsgWitnessBlockAckWrapper(Constants, Crypto, MsgWitnessCommon, witnessBlockAckProto)
    };
};
