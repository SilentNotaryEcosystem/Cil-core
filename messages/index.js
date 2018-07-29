const MsgVersionWrapper = require('./msgVersion');
const MsgCommonWrapper = require('./msgCommon');

module.exports = (NetworkMagic, objPrototypes) => {

    const {messageProto, versionPayloadProto} = objPrototypes;
    const MsgCommon = MsgCommonWrapper(NetworkMagic, messageProto);

    return {
        MsgCommon,
        MsgVersion: MsgVersionWrapper(MsgCommon, versionPayloadProto)
    };
};
