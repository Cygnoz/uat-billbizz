const mongoose = require("mongoose");
const { Schema } = mongoose;
 
 
const contactPersonsSchema = new Schema({
    salutation: {type:String},
    firstName: {type:String},
    lastName: {type:String},
    emailAddress: {type:String},
    workPhone: {type:String},
    mobile: {type:String},
}, { _id: false });


const bankDetailsSchema = new Schema({
    accountHolderName: {type:String},
    bankName: {type:String},
    accountNum: {type:String},
    ifscCode: {type:String},
}, { _id: false });
 
 
const supplierSchema = new Schema({
    // Basic 
    organizationId: {type:String},
    salutation: {type:String},
    firstName: {type:String},
    lastName: {type:String},

    companyName: {type:String},
    supplierDisplayName:{type:String},
    supplierEmail: {type:String},
    workPhone: {type:String},
    mobile: {type:String},     


    //Other Details
    pan: {type:String},
    currency: {type:String},
    paymentTerms: {type:String},
    tds: {type:String},
    creditDays :{type:Number},
    creditLimit :{type:Number},
    InterestPercentage :{type:Number},
    documents: {type:String},
    websiteURL: {type:String},
    department: {type:String},
    designation: {type:String},
    

    //Tax
    taxType:{type:String},
    gstTreatment: {type:String},
    gstin_uin: {type:String},
    sourceOfSupply: {type:String},
    businessLegalName: {type:String},
    businessTradeName: {type:String},
    msmeType: {type:String},
    msmeNumber:{type:String},
    msmeRegistered: {type:String},
    vatNumber: {type:String},

    // Billing Address
    billingAttention: {type:String},
    billingCountry: {type:String},
    billingAddressStreet1: {type:String},
    billingAddressStreet2:{type:String},
    billingCity: {type:String},
    billingState: {type:String},
    billingPinCode: {type:String},
    billingPhone: {type:String},
    billingFaxNum: {type:String},

    // Shipping Address
    shippingAttention: {type:String},
    shippingCountry: {type:String},
    shippingAddressStreet1: {type:String},
    shippingAddressStreet2:{type:String},
    shippingCity: {type:String},
    shippingState: {type:String},
    shippingPinCode: {type:String},
    shippingPhone: {type:String},
    shippingFaxNum: {type:String},
    
    // Contact Person
    contactPersons: [contactPersonsSchema],

    //Bank Details
    bankDetails: [bankDetailsSchema],

    //Remark
    remarks: {type:String},

    createdDate: {type:String},
    lastModifiedDate:{type:String}, 
        
    //Status
    status: {type:String},

});
 
const Supplier = mongoose.model("Supplier", supplierSchema);
 
module.exports = Supplier;


