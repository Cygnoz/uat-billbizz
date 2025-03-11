// v1.4

const mongoose = require("mongoose");
const { Schema } = mongoose;

const itemSchema = new Schema({
    //Basis
    organizationId: {type: String},
    itemType: { type: String },
    itemName: { type: String},
    itemImage: { type: String },
    sku: { type: String},

    //Unit
    unitName: { type: String },
    alterUnit: [
        {
            unitName: { type: String }, 
            conversionRate: { type: Number }, // eg: 5 (1 unitName = 5 alterUnit)  
        }
    ], 

    returnableItem: { type: Boolean },
    hsnCode: { type: String },
    sac:{type:String},
    taxPreference: { type: String },
    taxExemptReason: { type: String },        
    productUsage: { type: String },

    //Storage & Classification
    length:{type: Number},
    width:{type: Number},
    height:{type: Number},
    dimensionUnit:{type: String},

    warranty: { type: String },
    weight:{ type: Number },
    weightUnit:{ type: String },

    manufacturer: { type: String },
    brand: { type: String },
    categories: { type: String },
    rack: { type: String },

    upc:{ type: String },
    mpn:{ type: String },
    ean:{ type: String },
    isbn:{ type: String },

    //Sale Info
    sellingPrice: { type: Number },
    salesAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Accounts' },
    saleMrp: { type: Number },
    
    //Purchase Info
    costPrice: { type: Number },
    purchaseAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Accounts' },
    preferredVendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },

    taxRate:{type:String},
    cgst:{type:Number},
    sgst:{type:Number},
    igst:{type:Number},
    vat:{type:Number},

    openingStock:{type:Number},
    openingStockRatePerUnit:{type:Number},
    reorderPoint: { type: Number },
    
    createdDateTime: { type: Date, default: () => new Date() },
    lastModifiedDateTime: { type: Date, default: () => new Date() },

    
    // Sewnex additional variables
    barCode: { type: String },
    internalManufacturingItem: { type: Boolean },
    chooseService: { type: String },
    type: { type: String },
  
});

const Item = mongoose.model("Item", itemSchema);

module.exports = Item;