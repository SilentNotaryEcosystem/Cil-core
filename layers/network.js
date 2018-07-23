const EventEmitter=require('events');

class Network extends EventEmitter{
    constructor(options){
        const {address, relay, arrSeedNodes, listen} = options;

        super();
        this._arrSeedNodes=arrSeedNodes;
        this._relay=relay;
        this._address=address;

//        if(listen){
//            this.
//        }
    }

    get myAddress(){
        return this._address;
    }

    bootstrap(){
        if(!this._arrSeedNodes) throw new Error('Specify Seed Nodes!');
    }
}

module.exports=Network;
