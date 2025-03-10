const mongoose = require("mongoose");
const { Schema } = mongoose;
 

const expenseTableSchema = new Schema({
    expenseAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Accounts' },
    // expenseAccountName: { type: String },

    note: { type: String },

    taxGroup: { type: String }, // GST5,GST12...
    taxExemption: { type: String },

    sgst: { type: Number },
    cgst: { type: Number },
    igst: { type: Number },
    vat: { type: Number },

    sgstAmount: { type: Number },
    cgstAmount: { type: Number },
    igstAmount: { type: Number },
    vatAmount: { type: Number },

    amount: { type: Number }, // without tax amount
    
    total: {type:Number}    // This variable handle only if amountIs === "Tax Inclusive"
}, { _id: false });


const expenseSchema = new Schema({
    organizationId:{ type: String, index: true },
    expenseDate: { type: String },
    expenseNumber: { type: String },   //Prefix

    // employee: { type: String },

    paidThroughAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Accounts' },
    // paidThroughAccountName: {type:String},

    expenseCategory: {type:String},
    expenseType: {type:String},
    hsnCode: {type:String},
    sac: {type:String},

    taxMode: { type: String },  // Inter / Intra / None 

    distance: {type:Number},
    ratePerKm: {type:Number},

    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
    // supplierDisplayName: {type:String},
    
    gstTreatment: {type:String},
    gstin: {type:String},
    sourceOfSupply: {type:String},
    destinationOfSupply: {type:String},

    amountIs: {type:String},    // Tax Inclusive / Tax Exclusive
    invoice: {type:String},
    uploadFiles: {type:String},

    subTotal: {type:Number},
    sgst: { type: Number },
    cgst: { type: Number },        //*Amounts
    igst: { type: Number },
    vat: { type: Number },
    grandTotal: { type: Number },

    expense: [expenseTableSchema],

    createdDateTime: { type: Date, default: () => new Date() },
    
    //lastModifiedDate
    // lastModifiedDate:{type: Date},
    
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }

});
 
const Expense = mongoose.model("Expense", expenseSchema);
module.exports = Expense;