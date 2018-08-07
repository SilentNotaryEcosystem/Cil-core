const MsgAddrWrapper = require('./msgAddr');
const PeerInfoWrapper = require('./peerInfo');
const MsgVersionWrapper = require('./msgVersion');
const MsgCommonWrapper = require('./msgCommon');

module.exports = (Constants, objPrototypes) => {

    const {messageProto, versionPayloadProto, peerInfoProto, addrPayloadProto} = objPrototypes;
    const MsgCommon = MsgCommonWrapper(Constants.network, messageProto);

    return {
        MsgCommon,
        MsgVersion: MsgVersionWrapper(Constants, MsgCommon, versionPayloadProto),
        PeerInfo: PeerInfoWrapper(Constants, peerInfoProto),
        MsgAddr: MsgAddrWrapper(MsgCommon, addrPayloadProto)
    };
};
