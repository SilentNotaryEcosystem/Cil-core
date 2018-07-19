'use strict';
/**
 * JSON.stringify serializer
 */

class StringSerializer{
    /**
     *
     * @param {Object} objMessage - message to send to network
     * @return {Object}
     */
    static serialize(objMessage){
        return JSON.stringify(objMessage);
    }

    /**
     *
     * @param {Object} objMessage
     * @return {Object}
     */
    static deSerialize(objMessage){
        return JSON.parse(objMessage);
    }
}

module.exports=StringSerializer;
