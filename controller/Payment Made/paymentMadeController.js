const Organization = require("../../database/model/organization");
const Supplier = require('../../database/model/supplier');
const PurchasePayment = require('../../database/model/paymentMade');
const PurchaseBill = require('../../database/model/bills')
const mongoose = require('mongoose');
const Prefix = require("../../database/model/prefix");
const Account = require("../../database/model/account");
const TrialBalance = require("../../database/model/trialBalance");
const { cleanData } = require("../../services/cleanData");
const { singleCustomDateTime, multiCustomDateTime } = require("../../services/timeConverter");
const SupplierHistory = require("../../database/model/supplierHistory");

const moment = require("moment-timezone");


// Fetch existing data
const dataExist = async (organizationId, unpaidBills ,supplierId, ) => {
  const billIds = unpaidBills.map(unpaidBill => unpaidBill.billId);
  
  const [organizationExists, supplierExists , paymentTable , existingPrefix ] = await Promise.all([
    Organization.findOne({ organizationId }, { organizationId: 1, organizationCountry: 1, state: 1, timeZoneExp: 1 }),
    Supplier.findOne({ organizationId, _id: supplierId  }, { _id: 1, supplierDisplayName: 1 }),
    PurchaseBill.find({ organizationId , _id : { $in: billIds}},{ _id: 1, billNumber: 1 , billDate: 1 , dueDate:1 , grandTotal: 1 , balanceAmount : 1 }),
    Prefix.findOne({ organizationId })

  ]);
  
  return { organizationExists, supplierExists, paymentTable , existingPrefix };
};




const paymentDataExist = async ( organizationId, paymentId ) => {    
    
  const [organizationExists, allPayments, payments , paymentJournal ] = await Promise.all([
    Organization.findOne({ organizationId },{ timeZoneExp: 1, dateFormatExp: 1, dateSplit: 1, organizationCountry: 1 }).lean(),
    PurchasePayment.find({ organizationId })
    .populate('supplierId', 'supplierDisplayName')
    .lean(),    
    PurchasePayment.findOne({ organizationId , _id: paymentId })
    .populate('supplierId', 'supplierDisplayName')
    .lean(),
    TrialBalance.find({ organizationId: organizationId, operationId : paymentId })
    .populate('accountId', 'accountName')    
    .lean(),
  ]);
  return { organizationExists, allPayments, payments , paymentJournal };
};



// Fetch Acc existing data
const accDataExists = async ( organizationId, paidThroughAccountId, supplierId ) => {
  const [ paidThroughAccount, supplierAccount ] = await Promise.all([
    Account.findOne({ organizationId , _id: paidThroughAccountId, accountHead: "Asset" }, { _id:1, accountName: 1 }),
    Account.findOne({ organizationId , accountId:supplierId },{ _id:1, accountName:1 })
  ]);
  return { paidThroughAccount, supplierAccount };
};








exports.addPayment = async (req, res) => {
  console.log("Add Payment :",req.body);  
  try {
    const { organizationId, id: userId, userName } = req.user; 
    const cleanedData = cleanData(req.body);

    cleanedData.unpaidBills = cleanedData.unpaidBills.filter(unpaidBills => unpaidBills.payment > 0);

    const { unpaidBills, amountPaid, supplierId } = cleanedData; 
    const billIds = unpaidBills.map(unpaidBill => unpaidBill.billId);

    // Check for duplicate billIds
    const uniqueBillIds = new Set(billIds);
    if (uniqueBillIds.size !== billIds.length) {
      return res.status(400).json({ message: "Duplicate bill found" });
    }

    // cleanedData.paidThroughAccountId = cleanedData.paidThrough;

    // Validate SupplierId
    if (!mongoose.Types.ObjectId.isValid(supplierId) || supplierId.length !== 24) {
      return res.status(400).json({ message: `Invalid supplier ID: ${supplierId}` });
    }

    // Validate Bill IDs
    const invalidBillIds = billIds.filter(billId => !mongoose.Types.ObjectId.isValid(billId) || billId.length !== 24);
    if (invalidBillIds.length > 0) {
      return res.status(400).json({ message: `Invalid bill IDs: ${invalidBillIds.join(', ')}` });
    }

    // Check if organization and supplier exist
    const { organizationExists, supplierExists, paymentTable, existingPrefix } = await dataExist(organizationId, unpaidBills, supplierId );
    
    const { paidThroughAccount, supplierAccount } = await accDataExists( organizationId, cleanedData.paidThroughAccountId, cleanedData.supplierId );


    // Validate supplier and organization
    if (!validateSupplierAndOrganization(organizationExists, supplierExists, existingPrefix, res)) {
      return; 
    }

    // Validate input values, unpaidBills, and paymentTable
    if (!validateInputs(cleanedData, unpaidBills, paymentTable, paidThroughAccount, supplierAccount,  res)) {
      return; 
    }

    // Calculate the total payment made
    const updatedData = await calculateTotalPaymentMade(cleanedData, amountPaid );

    
    // Validate and ensure all unpaid bills are properly formatted
    const validatedBills = validateUnpaidBills(updatedData.unpaidBills);
    
    // Process unpaid bills and calculate `amountDue`
    await processUnpaidBills(validatedBills);
        
    // Generate prefix for vendor payment
    await vendorPaymentPrefix(cleanedData, existingPrefix);
  
    // Re-fetch the updated bills to get the latest `amountDue` and `balanceAmount`
    const updatedBills = await PurchaseBill.find({ _id: { $in: updatedData.unpaidBills.map(bill => bill.billId) } });

    cleanedData.createdDateTime = moment.tz(cleanedData.paymentDate, "YYYY-MM-DDTHH:mm:ss.SSS[Z]", organizationExists.timeZoneExp).toISOString();           

    // Create and save new payment
    const payment = await createNewPayment(updatedData, organizationId, userId, userName);

    // Add entry to Supplier History
    const supplierHistoryEntry = new SupplierHistory({
      organizationId,
      operationId: payment._id,
      supplierId,
      title: "Payment Made Added",
      description: `Payment Made ${payment.paymentMade} of amount ${payment.total} created by ${userName}`,  
      userId: userId,
      userName: userName,
    });

    await supplierHistoryEntry.save();

    //Journal
    await journal( payment, paidThroughAccount, supplierAccount );

    //Response with the updated bills and the success message
    return res.status(200).json({ message: 'Payment added successfully',  payment , updatedBills });

  } catch (error) {
    console.error('Error adding payment:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};





exports.getAllPayment = async (req, res) => {
  try {
    const organizationId  = req.user.organizationId;

    const { organizationExists , allPayments} = await paymentDataExist( organizationId, null );

    if (!organizationExists) return res.status(404).json({ message: "Organization not found" });
    
    if (!allPayments.length) return res.status(404).json({ message: "No Payments found" });
    

    const transformedData = allPayments.map(data => {
      return {
        ...data,
        supplierId: data.supplierId?._id,  
        supplierDisplayName: data.supplierId?.supplierDisplayName,  
      };}); 

      const formattedObjects = multiCustomDateTime(transformedData, organizationExists.dateFormatExp, organizationExists.timeZoneExp, organizationExists.dateSplit );    

    res.status(200).json({allPayments: formattedObjects});
  } catch (error) {
    console.error("Error fetching purchase paymentMade:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};



// Get One Payment Quote
exports.getPurchasePayment = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const  paymentId = req.params.paymentId;

    const { organizationExists , payments } = await paymentDataExist(organizationId , paymentId);

    if (!organizationExists) return res.status(404).json({ message: "Organization not found" });
    
    if (!payments) return res.status(404).json({ message: "No payment found" });
    

    const transformedData = {
      ...payments,
      supplierId: payments.supplierId?._id,  
      supplierDisplayName: payments.supplierId?.supplierDisplayName,
      };
      
    const formattedObjects = singleCustomDateTime(transformedData, organizationExists.dateFormatExp, organizationExists.timeZoneExp, organizationExists.dateSplit );        

    res.status(200).json(formattedObjects);
  } catch (error) {
    console.error("Error fetching Payments:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};





// Get receipt Journal
exports.paymentJournal = async (req, res) => {
  try {
      const organizationId = req.user.organizationId;
      const { paymentId } = req.params;

      const { paymentJournal } = await paymentDataExist( organizationId, paymentId );      

      if (!paymentJournal) {
          return res.status(404).json({
              message: "No Journal found for the Invoice.",
          });
      }

      const transformedJournal = paymentJournal.map(item => {
        return {
            ...item,
            accountId: item.accountId?._id,  
            accountName: item.accountId?.accountName,  
        };
    });    
      
      res.status(200).json(transformedJournal);
  } catch (error) {
      console.error("Error fetching journal:", error);
      res.status(500).json({ message: "Internal server error." });
  }
};





// Get Last payment Prefix
exports.getLastPaymentMadePrefix = async (req, res) => {
  try {
      const organizationId = req.user.organizationId;

      // Find all accounts where organizationId matches
      const prefix = await Prefix.findOne({ organizationId:organizationId,'series.status': true });

      if (!prefix) {
          return res.status(404).json({
              message: "No Prefix found for the provided organization ID.",
          });
      }
      
      const series = prefix.series[0];     
      const lastPrefix = series.payment + series.paymentNum;

      lastPrefix.organizationId = undefined;

      res.status(200).json(lastPrefix);
  } catch (error) {
      console.error("Error fetching accounts:", error);
      res.status(500).json({ message: "Internal server error." });
  }
};




// Purchase Prefix
function vendorPaymentPrefix( cleanData, existingPrefix ) {
  const activeSeries = existingPrefix.series.find(series => series.status === true);
  if (!activeSeries) {
      return res.status(404).json({ message: "No active series found for the organization." });
  }
  cleanData.paymentMade  = `${activeSeries.payment}${activeSeries.paymentNum}`;

  activeSeries.paymentNum += 1;

  existingPrefix.save() 
}






//   //Clean Data 
// function cleanSupplierData(data) {
//     const cleanData = (value) => (value === null || value === undefined || value === "" ? undefined : value);
//     const cleanedData = Object.keys(data).reduce((acc, key) => {
//       acc[key] = cleanData(data[key]);
//       return acc;
//     }, {});

//     // Filter unpaidBills where payment is greater than 0
//     if (Array.isArray(cleanedData.unpaidBills)) {
//       cleanedData.unpaidBills = cleanedData.unpaidBills.filter(bill => {
//           return bill.payment && bill.payment > 0;
//       });
//     }

//   return cleanedData;
// }







  // Validate Supplier and Organization
function validateSupplierAndOrganization(organizationExists, supplierExists, existingPrefix ,res) {
    if (!organizationExists) {
        res.status(404).json({ message: "Organization not found" });
        return false;
    }
    if (!supplierExists) {
        res.status(404).json({ message: "Supplier not found" });
        return false;
    }
    if (!existingPrefix) {
      res.status(404).json({ message: "Prefix not found" });
      return false;
  }
    return true;

}










//Validate inputs
function validateInputs( data, unpaidBills , paymentTableExist,  paidThroughAccount, supplierAccount, res) {
  const validationErrors = validatePaymentData(data, unpaidBills , paymentTableExist, paidThroughAccount, supplierAccount);

  if (validationErrors.length > 0) {
    res.status(400).json({ message: validationErrors.join(", ") });
    return false;
  }
  return true;
}

// Function to create a new payment record
function createNewPayment(data, organizationId, userId, userName) {
  const newPayment = new PurchasePayment({
    ...data,
    organizationId,
    userId,
    userName
  });
  return newPayment.save(); // Save the payment to the database
}

//Validate Data
function validatePaymentData( data, unpaidBills, paymentTable, paidThroughAccount, supplierAccount ) {
  const errors = [];

  // console.log("Bills Request :",unpaidBills);
  // console.log("Bills Fetched :",paymentTable);

  //Basic Info
  validateReqFields( data, paidThroughAccount, supplierAccount, errors );
  validatePaymentTable(unpaidBills, paymentTable, errors);


  validateFloatFields(['amountPaid','amountUsedForPayments','amountInExcess'], data, errors);

  validatePaymentMode(data.paymentMode, errors);

  //Currency
  // validateCurrency(data.currency, validCurrencies, errors);

  return errors;
}

// Field validation utility
function validateField(condition, errorMsg, errors) {
    if (condition) errors.push(errorMsg);
}

//Valid Req Fields
function validateReqFields( data, paidThroughAccount, supplierAccount, errors ) {

  validateField( typeof data.supplierId === 'undefined', "Please select a supplier", errors  );
  validateField( typeof data.unpaidBills === 'undefined' || (Array.isArray(data.unpaidBills) && data.unpaidBills.length === 0), "Select a bill", errors  );

  validateField( typeof data.amountPaid === 'undefined' || data.amountPaid === 0 || typeof data.amountUsedForPayments === 'undefined' || data.amountUsedForPayments === 0, "Enter amount paid", errors  );

  validateField( typeof data.paymentMode === 'undefined' , "Select payment mode", errors  );
  validateField( typeof data.paymentDate === 'undefined' , "Select payment date", errors  );

  validateField( typeof data.unpaidBills === 'undefined', "Select an Bill", errors  );

  validateField( typeof data.paidThroughAccountId === 'undefined' , "Select paid through account", errors  );
  validateField( !paidThroughAccount && typeof data.amountPaid !== 'undefined' , "Paid Through Account not found", errors  );
  validateField( !supplierAccount && typeof data.amountPaid !== 'undefined' , "Supplier Account not found", errors  );


}


// Function to Validate Item Table 
function validatePaymentTable(unpaidBills, paymentTable, errors) {
  // console.log("unpaidBills:",unpaidBills)
  // console.log("paymentTable:", paymentTable)
  // Check for bill count mismatch
  validateField( unpaidBills.length !== paymentTable.length, "Mismatch in bills count between request and database.", errors  );

  // Iterate through each bills to validate individual fields
  unpaidBills.forEach((unpaidBill) => {
    const fetchedBills = paymentTable.find(it => it._id.toString() === unpaidBill.billId);

    // Check if item exists in the item table
    validateField( !fetchedBills, `Bill with ID ${unpaidBill.billId} was not found.`, errors );
    if (!fetchedBills) return; 

     // Validate bill number
     validateField( unpaidBill.billNumber !== fetchedBills.billNumber, `Bill Number Mismatch Bill Number: ${unpaidBill.billNumber}`, errors );

    // Validate bill date
    validateField( unpaidBill.billDate !== fetchedBills.billDate, `Bill Date Mismatch Bill Number: ${unpaidBill.billNumber} : ${unpaidBill.billDate}` , errors );

    // Validate dueDate
    validateField( unpaidBill.dueDate !== fetchedBills.dueDate, `Due Date Mismatch for Bill Number${unpaidBill.billNumber}:  ${unpaidBill.dueDate}`, errors );

    // Validate billAmount
    validateField( unpaidBill.billAmount !== fetchedBills.grandTotal, `Grand Total for Bill Number${unpaidBill.billNumber}: ${unpaidBill.billAmount}`, errors );

    // Validate amountDue
    validateField( unpaidBill.amountDue !== fetchedBills.balanceAmount, `Amount Due for bill number ${unpaidBill.billNumber}: ${unpaidBill.amountDue}`, errors );

    // Validate float fields
    validateFloatFields(['amountDue', 'billAmount', 'payment'], unpaidBill, errors);

  });
}

// Validate Payment Mode
function validatePaymentMode(paymentMode, errors) {
  validateField(
    paymentMode && !validPaymentMode.includes(paymentMode),
    "Invalid Payment Mode: " + paymentMode, errors );
}



//Valid Float Fields  
function validateFloatFields(fields, data, errors) {
  fields.forEach((balance) => {
    validateField(data[balance] && !isFloat(data[balance]),
      "Invalid " + balance.replace(/([A-Z])/g, " $1") + ": " + data[balance], errors);
  });
}












// Helper functions to handle formatting
function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function formatCamelCase(word) {
  return word.replace(/([A-Z])/g, " $1");
}

// Validation helpers
function isAlphabets(value) {
  return /^[A-Za-z\s]+$/.test(value);
}

function isFloat(value) {
  return /^-?\d+(\.\d+)?$/.test(value);
}

function isInteger(value) {
  return /^\d+$/.test(value);
}

function isAlphanumeric(value) {
  return /^[A-Za-z0-9]+$/.test(value);
}


const calculateAmountDue = async (billId, { amount }) => {
  try {
    // Find the bill by its ID
    const bill = await PurchaseBill.findById(billId);

    if (!bill) {
      throw new Error(`Bill not found with ID: ${billId}`);
    }


    // Initialize fields if undefined
    bill.paidAmount = typeof bill.paidAmount === 'number' ? bill.paidAmount : 0;
    bill.balanceAmount = typeof bill.balanceAmount === 'number' ? bill.balanceAmount : bill.grandTotal;

    // Calculate new paidAmount and balanceAmount
    bill.paidAmount += amount;
    bill.balanceAmount = bill.grandTotal - bill.paidAmount;

    // Ensure values are within correct bounds
    if (bill.balanceAmount < 0) {
      bill.balanceAmount = 0;
    }
    if (bill.paidAmount > bill.grandTotal) {
      bill.paidAmount = bill.grandTotal;
    }

    // Save the updated bill with new balanceAmount and paidAmount
    await bill.save();

    // Log the updated bill status for debugging
    // console.log(`Updated Bill ID ${billId}: Paid Amount: ${bill.paidAmount}, Balance Amount: ${bill.balanceAmount}`);

    // Check if payment is complete
    if (bill.balanceAmount === 0) {
      return {
        message: `Payment completed for Bill ID ${billId}. No further payments are needed.`,
        bill,
      };
    }

    return { message: 'Payment processed', bill };

  } catch (error) {
    console.error(`Error calculating amount due for Bill ID ${billId}:`, error);
    throw new Error(`Error calculating amount due for Bill ID ${billId}: ${error.message}`);
  }
};



const calculateTotalPaymentMade = async (cleanedData, amountPaid) => {
  let totalPayment = 0;

  // Sum the `payment` amounts from each unpaid bill in the array
  for (const bill of cleanedData.unpaidBills) {
    totalPayment += bill.payment || 0; // Ensure `payment` is a number and add it
  }

  // Assign the total to both `total` and `amountPaid` field in `cleanedData`
  cleanedData.total = totalPayment;
  cleanedData.amountPaid = totalPayment;

  // Calculate amountUsedForPayments and amountInExcess
  amountPaid = cleanedData.amountPaid || 0;
  cleanedData.amountUsedForPayments = totalPayment;

  return cleanedData;
};




// Validate unpaid bills and set default payment values
function validateUnpaidBills(unpaidBills) {
  return unpaidBills.map(bill => {
    if (typeof bill.payment === 'undefined') {
      console.warn(`Payment field missing for bill ID: ${bill.billId}`);
      bill.payment = 0; // Default payment to 0
    }
    return bill;
  });
}

// Process and calculate amountDue for unpaid bills
async function processUnpaidBills(unpaidBills) {
  const results = [];
  for (const bill of unpaidBills) {
    try {
      const result = await calculateAmountDue(bill.billId, { amount: bill.payment });
      results.push(result);
    } catch (error) {
      console.error(`Error processing bill ID: ${bill.billId}`, error);
      throw error; // Re-throw for higher-level error handling
    }
  }
  return results;
}


const validPaymentMode = [ "Cash", "check", "Card", "Bank Transfer" ]


























async function journal( payment, paidThroughAccount, supplierAccount ) {    
  const supplierReceived = {
    organizationId: payment.organizationId,
    operationId: payment._id,
    transactionId: payment.paymentMade,
    accountId: supplierAccount._id || undefined,
    action: "Payment Made",
    debitAmount: payment.amountPaid || 0,
    creditAmount: 0,
    remark: payment.note,
    createdDateTime:payment.createdDateTime
  };
  const paidThroughAcc = {
    organizationId: payment.organizationId,
    operationId: payment._id,
    transactionId: payment.paymentMade,
    accountId: paidThroughAccount._id || undefined,
    action: "Payment Made",
    debitAmount: 0,
    creditAmount: payment.amountPaid || 0,
    remark: payment.note,
    createdDateTime:payment.createdDateTime
  };
  

  console.log("supplierReceived", supplierReceived.debitAmount,  supplierReceived.creditAmount);
  console.log("paidThroughAcc", paidThroughAcc.debitAmount,  paidThroughAcc.creditAmount);

  const  debitAmount = supplierReceived.debitAmount + paidThroughAcc.debitAmount ;
  const  creditAmount = supplierReceived.creditAmount + paidThroughAcc.creditAmount ;

  console.log("Total Debit Amount: ", debitAmount );
  console.log("Total Credit Amount: ", creditAmount );
  
  createTrialEntry( supplierReceived )
  createTrialEntry( paidThroughAcc )
}





async function createTrialEntry( data ) {
  const newTrialEntry = new TrialBalance({
      organizationId:data.organizationId,
      operationId:data.operationId,
      transactionId: data.transactionId,
      accountId: data.accountId,
      action: data.action,
      debitAmount: data.debitAmount,
      creditAmount: data.creditAmount,
      remark: data.remark,
      createdDateTime:data.createdDateTime

});

await newTrialEntry.save();

}












exports.dataExist = {
  dataExist,
  paymentDataExist,
  accDataExists
};
exports.validation = {
  validateSupplierAndOrganization, 
  validateInputs,
  validateUnpaidBills,
  validPaymentMode
};
exports.calculation = { 
  calculateTotalPaymentMade,
  processUnpaidBills
};
exports.accounts = { 
  journal
};