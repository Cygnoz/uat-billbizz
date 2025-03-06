const mongoose = require("mongoose");
const { Schema } = mongoose;


const supplierHistorySchema = new Schema({
  organizationId: {type:String},
  operationId: { type: String },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  // supplierDisplayName: { type: String },
  date: { type: String },
  title: { type: String },
  description: { type: String },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // userName: { type: String },
  createdDateTime: { type: Date, default: () => new Date() },

});

const supplierHistory = mongoose.model("Supplier History", supplierHistorySchema);

module.exports = supplierHistory;










     