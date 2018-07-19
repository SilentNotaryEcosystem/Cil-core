const EventEmitter=require('events');

class Network extends EventEmitter{
    constructor(arrSeedNodesAddress=[], address){
        super();
        if(!arrSeedNodesAddress || !arrSeedNodesAddress.length) throw new Error('Specify Seed Nodes!');
        this._arrSeedNodesAddress=arrSeedNodesAddress;
        this._address=address;
    }
    bootstrap(){

    }
    connectToPeers(){

    }

    get myAddress(){
        return this._address;
    }
}

module.exports=Network;
