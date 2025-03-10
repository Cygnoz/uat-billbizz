// v1.3

const mongoose = require("mongoose");
const { Schema } = mongoose;


const itemTrackSchema = new Schema({
    organizationId: {type:String}, 
    operationId: {type:String}, //Sales, Purchase ... id
    transactionId: {type:String}, //Prefix
    action: {type:String}, //Sale, Sale return, Purchase, Purchase Return,Opening Stock, Inventory Adjustment
 
    itemId: {type: mongoose.Schema.Types.ObjectId, ref: 'Item'},
    //itemName

    sellingPrice:{ type:Number },
    costPrice: { type: Number },

    creditQuantity: {type:Number},
    debitQuantity: {type:Number},
        
    createdDateTime: { type: Date, default: () => new Date() },

}); 
// , { timestamps: true }
const ItemTrack = mongoose.model("ItemTrack", itemTrackSchema);

module.exports = ItemTrack;