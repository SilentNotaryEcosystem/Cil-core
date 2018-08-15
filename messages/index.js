const MsgAddrWrapper = require('./msgAddr');
const PeerInfoWrapper = require('./peerInfo');
const MsgVersionWrapper = require('./msgVersion');
const MsgRejectWrapper = require('./msgReject');
const MsgCommonWrapper = require('./msgCommon');

module.exports = (Constants, Crypto, objPrototypes) => {

    const {messageProto, versionPayloadProto, peerInfoProto, addrPayloadProto, rejectPayloadProto} = objPrototypes;
    const MsgCommon = MsgCommonWrapper(Crypto, Constants.network, messageProto);

    return {
        MsgCommon,
        MsgVersion: MsgVersionWrapper(Constants, MsgCommon, versionPayloadProto),
        PeerInfo: PeerInfoWrapper(Constants, peerInfoProto),
        MsgAddr: MsgAddrWrapper(MsgCommon, addrPayloadProto),
        MsgReject: MsgRejectWrapper(MsgCommon, rejectPayloadProto)
    };
};
