// v1.2

const mongoose = require("mongoose");
const { Schema } = mongoose;

const contactPersonSchema = new Schema({
    salutation: {type:String},
    firstName: {type:String},
    lastName: {type:String},
    email: {type:String},
    mobile: {type:String},
  }, { _id: false });



const customerSchema = new Schema({
    //Basic Info
    organizationId: {type:String},
    customerType: {type:String},
    customerProfile: {type:String},   //image
    salutation: {type:String},
    firstName: {type:String},
    lastName: {type:String},
    companyName: {type:String},
    customerDisplayName: {type:String},

    customerEmail: {type:String},
    workPhone: {type:String},
    mobile: {type:String},
    
    dob: {type:String},
    cardNumber: {type:String},

    //Opening Balance
    debitOpeningBalance: {type:Number},
    creditOpeningBalance: {type:Number},

    //Other Details
    pan: {type:String},
    currency: {type:String},
    creditDays: {type:Number},
    creditLimits: {type:Number},
    interestPercentage: {type:Number},
    paymentTerms: {type:String},
    enablePortal:{type:Boolean},
    documents: {type:String},
    department: {type:String},
    designation: {type:String},
    websiteURL: {type:String},

    //Taxes
    taxPreference: {type:String},
    taxReason: {type:String},
    taxType: {type:String},
    gstTreatment: {type:String},
    gstin_uin: {type:String},
    placeOfSupply: {type:String},
    businessLegalName: {type:String},
    businessTradeName: {type:String},
    vatNumber: {type:String},
    vatTreatment: {type:String},
    

    //Billing Address
    billingAttention: {type:String},
    billingCountry: {type:String},
    billingAddressLine1: {type:String},
    billingAddressLine2: {type:String},
    billingCity: {type:String},
    billingState: {type:String},
    billingPinCode: {type:String},
    billingPhone: {type:String},
    billingFaxNumber: {type:String},

    //Shipping Address
    shippingAttention: {type:String},
    shippingCountry: {type:String},
    shippingAddress1: {type:String},
    shippingAddress2: {type:String},
    shippingCity: {type:String},
    shippingState: {type:String},
    shippingPinCode: {type:String},
    shippingPhone: {type:String},
    shippingFaxNumber: {type:String},

    contactPerson: [contactPersonSchema],

    remark: {type:String},

    //Status
    status : {type:String},

    //Create info
    createdDateTime: { type: Date, default: () => new Date() },

    //lastModifiedDate
    lastModifiedDate:{type:String},

    // *Sewnex variables
    customerAddress: {type:String},  

    companyAddress: {type:String},  

    membershipCardNumber: {type:String}, 
    referenceCustomerId: {type: mongoose.Schema.Types.ObjectId, ref: 'Customer'},    

    anniversary: {type:String},  
    profession: {type:String},  
    
    twitter: {type:String}, 
    instagram: {type:String},  
    snapchat: {type:String}, 
    facebook: {type:String},  

});

const Customer = mongoose.model("Customer", customerSchema);

module.exports = Customer;