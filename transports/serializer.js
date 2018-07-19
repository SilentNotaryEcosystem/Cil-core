/**
 * Abstract class for serializing/desirializing objects to network
 */

class Serializer{
    /**
     *
     * @param {Object} objMessage - message to send to network
     * @return {}
     */
    static serialize(objMessage){
        throw new Error('Should implement!');
    }

    /**
     *
     * @param message
     * @return {Object}
     */
    static deSerialize(message){
        throw new Error('Should implement!');
    }
}

module.exports=Serializer;
