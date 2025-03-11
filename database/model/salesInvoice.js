//v1.2

const mongoose = require('mongoose')
const { Schema } = mongoose

const itemsSchema = new Schema({

  itemId: {type: mongoose.Schema.Types.ObjectId, ref: 'Item'},
  //itemName

  quantity: {type:Number},
  returnQuantity: { type: Number, default: 0 }, 
  sellingPrice: {type:Number},

  taxPreference: {type:String},
  taxGroup: {type:String},
  cgst: { type: Number },
  sgst: { type: Number },
  igst: { type: Number },
  vat: { type: Number },

  cgstAmount: { type: Number },
  sgstAmount: { type: Number },
  igstAmount: { type: Number },
  vatAmount: { type: Number },

  itemTotalTax: {type:Number},

  discountType: {type:String}, //Currency,Percentage
  discountAmount: {type:Number}, 
  itemAmount: {type:Number},
  salesAccountId: {type:String}

  }, { _id: false });


const journalSchema = new Schema({
  accountId: {type: mongoose.Schema.Types.ObjectId, ref: 'Accounts'},
  debitAmount: {type:Number},
  creditAmount: {type:Number},
  }, { _id: false });


const SalesInvoiceSchema = new Schema ({

  organizationId: { type: String, index: true },
  
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  //customerName
  placeOfSupply: { type: String },  
  reference: { type: String },

  salesInvoice: { type: String }, //prefix
  //salesPersonId: { type: String }, //next phase
  //salesPersonName: { type: String }, //next phase

  salesOrderNumber: { type: String },
  
  //new
  paymentTerms: { type: String },
  deliveryMethod: { type: String },
  expectedShipmentDate: { type: String },

  salesInvoiceDate: { type: String },
  dueDate: { type: String },

  // subject: { type: String },
  
  items: [itemsSchema],  
  
  note: { type: String },
  tc: { type: String },

  //new
  otherExpenseAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Accounts' },
  otherExpenseAmount: { type: Number },
  otherExpenseReason: { type: String },
  
  vehicleNumber: { type: String },
  
  freightAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Accounts' },
  freightAmount: { type: Number },
  
  roundOffAmount: { type: Number },

  discountTransactionType: { type: String }, // Currency,Percentage
  discountTransactionAmount: { type: Number },
  taxType: { type: String },//Intra, Inter, Non-tax, VAT 

  saleAmount: { type: Number },
  
  subTotal: { type: Number },
  totalItem: { type: Number },

  cgst: { type: Number },
  sgst: { type: Number },
  igst: { type: Number },
  vat: { type: Number },
  totalTax: { type: Number },
  totalAmount: { type: Number },
  totalDiscount: { type: Number },

  paidAmount: { type: Number }, 
  balanceAmount: { type: Number },
  depositAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Accounts' },

  paymentMethod: { type: String },

  paidStatus: { type: String },

  salesOrderId: { type: String },

  salesJournal:[ journalSchema ], 

  createdDateTime: { type: Date, default: () => new Date() },

  //lastModifiedDate
  // lastModifiedDate:{type: Date},

  editLimit: {type: Boolean, default: true},   // true - before taxation file date  |  false - after taxation file date

  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  //userName

})


const SalesInvoice = mongoose.model("SalesInvoice", SalesInvoiceSchema);

module.exports = SalesInvoice;



