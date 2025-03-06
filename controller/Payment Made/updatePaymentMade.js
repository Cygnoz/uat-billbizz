const mongoose = require('mongoose');
const PaymentMade = require('../../database/model/paymentMade');
const TrialBalance = require("../../database/model/trialBalance");
const Bill = require("../../database/model/bills");
const { dataExist, validation, calculation, accounts } = require("../Payment Made/paymentMadeController");
const { cleanData } = require("../../services/cleanData");
const SupplierHistory = require("../../database/model/supplierHistory");

const moment = require("moment-timezone");



// Update Payment Made
exports.updatePaymentMade = async (req, res) => {
    console.log("Update payment made:", req.body);
  
    try {
      const { organizationId, id: userId, userName } = req.user;
      const { paymentId } = req.params;  

      // Fetch existing sales receipt
      const existingPaymentMade = await getExistingPaymentMade(paymentId, organizationId, res);
      // console.log("existingPaymentMade",existingPaymentMade);
      
      // Extract paymentAmount values
      const existingPaymentMadeBills = existingPaymentMade.unpaidBills;

      // Clean input data
      const cleanedData = cleanData(req.body);

      const { unpaidBills, amountPaid, supplierId } = cleanedData;      

      const billIds = unpaidBills.map(unpaidBill => unpaidBill.billId);

      // Fetch the latest payment made for the given supplierId and organizationId
      const latestPaymentMade = await getLatestPaymentMade(paymentId, organizationId, supplierId, billIds, res);
      if (latestPaymentMade) {
        return; 
      }
    
      // Validate _id's
      const validateAllIds = validateIds({ billIds, supplierId });
      if (validateAllIds) {
        return res.status(400).json({ message: validateAllIds });
      }


      // Ensure `paymentMade` field matches the existing payment
      if (cleanedData.paymentMade !== existingPaymentMade.paymentMade) {
        return res.status(400).json({
          message: `The provided paymentMade does not match the existing record. Expected: ${existingPaymentMade.paymentMade}`,
        });
      }

      // Fetch related data
      const { organizationExists, supplierExists, paymentTable, existingPrefix } = await dataExist.dataExist( organizationId, unpaidBills, supplierId );  
      
      const { paidThroughAccount, supplierAccount } = await dataExist.accDataExists( organizationId, cleanedData.paidThroughAccountId, cleanedData.supplierId ); 
        
      //Data Exist Validation
      if (!validation.validateSupplierAndOrganization( organizationExists, supplierExists, existingPrefix, res )) return;

      // Validate Input values, unpaidBills, and paymentTable
      if (!validateInputs(cleanedData, unpaidBills, paymentTable, paidThroughAccount, supplierAccount, res)) return;

      const updatedData = await calculation.calculateTotalPaymentMade(cleanedData, amountPaid );
      
      // Validate bills
      const validatedBills = validation.validateUnpaidBills(updatedData.unpaidBills);
      
      // Process invoices
      await processUnpaidBills(validatedBills, existingPaymentMadeBills);

      // Validate Inputs
      if (!validateUpdatedInputs(cleanedData, existingPaymentMade, res)) return;

      // Re-fetch the updated invoice to get the latest `amountDue` and `balanceAmount`
      await Bill.find({ _id: { $in: updatedData.unpaidBills.map(bill => bill.billId) } });

      cleanedData.createdDateTime = moment.tz(cleanedData.paymentDate, "YYYY-MM-DDTHH:mm:ss.SSS[Z]", organizationExists.timeZoneExp).toISOString();           

      const mongooseDocument = PaymentMade.hydrate(existingPaymentMade);
      Object.assign(mongooseDocument, cleanedData);
      const savedPaymentMade = await mongooseDocument.save();
      if (!savedPaymentMade) {
        return res.status(500).json({ message: "Failed to update payment made" });
      }

      // Add entry to Supplier History
      const supplierHistoryEntry = new SupplierHistory({
        organizationId,
        operationId: savedPaymentMade._id,
        supplierId,
        title: "Payment Made Updated",
        description: `Payment Made ${savedPaymentMade.paymentMade} updated by ${userName}`,  
        userId: userId,
        userName: userName,
      });

      await supplierHistoryEntry.save();

      //Journal
      await journal( savedPaymentMade, paidThroughAccount, supplierAccount );
      
      res.status(200).json({ message: "Payment made updated successfully", savedPaymentMade });
      // console.log("Payment made updated successfully:", savedPaymentMade);
  
    } catch (error) {
      console.error("Error updating payment made:", error);
      res.status(500).json({ message: "Internal server error" });
    }
};




// Delete Payment Made
exports.deletePaymentMade = async (req, res) => {
  console.log("Delete payment made request received:", req.params);

  try {
      const { organizationId, id: userId, userName } = req.user;
      const { paymentId } = req.params;

      // Validate paymentId
      if (!mongoose.Types.ObjectId.isValid(paymentId) || paymentId.length !== 24) {
          return res.status(400).json({ message: `Invalid Payment Made ID: ${paymentId}` });
      }

      // Fetch existing payment made
      const existingPaymentMade = await getExistingPaymentMade(paymentId, organizationId, res);

      const { unpaidBills, supplierId } = existingPaymentMade;

      const billIds = unpaidBills.map(bill => bill.billId);      

      // Fetch the latest paymentMade for the given supplierId and organizationId
      const latestPaymentMade = await PaymentMade.findOne({ 
        organizationId, 
        supplierId,
        "unpaidBills.billId": { $in: billIds }, 
      }).sort({ createdDateTime: -1 }); // Sort by createdDateTime in descending order
    
      if (!latestPaymentMade) {
          console.log("No payment made found for this supplier.");
          return res.status(404).json({ message: "No payment made found for this supplier." });
      }
    
      // Check if the provided paymentId matches the latest one
      if (latestPaymentMade._id.toString() !== paymentId) {
        return res.status(400).json({
          message: "Only the latest payment made can be deleted."
        });
      }

      // Extract payment made bills
      const existingPaymentMadeBills = existingPaymentMade.unpaidBills;

      // Add entry to Supplier History
      const supplierHistoryEntry = new SupplierHistory({
        organizationId,
        operationId: existingPaymentMade._id,
        supplierId,
        title: "Payment Made Deleted",
        description: `Payment Made ${existingPaymentMade.paymentMade} deleted by ${userName}`,  
        userId: userId,
        userName: userName,
      });

      // Delete the payment made
      const deletedPaymentMade = await existingPaymentMade.deleteOne();
      if (!deletedPaymentMade) {
          console.error("Failed to delete payment made.");
          return res.status(500).json({ message: "Failed to delete payment made!" });
      }

      await supplierHistoryEntry.save();

      // Fetch existing TrialBalance's createdDateTime
      const existingTrialBalance = await TrialBalance.findOne({ 
        organizationId: existingPaymentMade.organizationId,
        operationId: existingPaymentMade._id,
      });  
      // If there are existing entries, delete them
      if (existingTrialBalance) {
        await TrialBalance.deleteMany({
          organizationId: existingPaymentMade.organizationId,
          operationId: existingPaymentMade._id,
        });
        console.log(`Deleted existing TrialBalance entries for operationId: ${existingPaymentMade._id}`);
      }

      // Return balance amount after deletion
      await returnBalanceAmount( existingPaymentMadeBills );

      res.status(200).json({ message: "Payment made deleted successfully" });
      console.log("Payment made deleted successfully with ID:", paymentId);

  } catch (error) {
      console.error("Error deleting payment made:", error);
      res.status(500).json({ message: "Internal server error" });
  }
};







// Get Existing Sales Receipt
async function getExistingPaymentMade(paymentId, organizationId, res) {
  console.log("paymentId",paymentId);
  console.log("organizationId",organizationId);

  const existingPaymentMade = await PaymentMade.findOne({ _id: paymentId, organizationId: organizationId });
  console.log("existingPaymentMade",existingPaymentMade);
  
  if (!existingPaymentMade) {
      console.log("Payment made not found with ID:", paymentId);
      return res.status(404).json({ message: "Payment made not found" });
  }
  return existingPaymentMade;
}


// Get Latest Payment Made
async function getLatestPaymentMade(paymentId, organizationId, supplierId, billIds, res) {
  const latestPayment = await PaymentMade.findOne({ 
      organizationId, 
      supplierId,
      "unpaidBills.billId": { $in: billIds }, 
  }).sort({ createdDateTime: -1 }); // Sort by createdDateTime in descending order

  if (!latestPayment) {
      console.log("No payment made found for this supplier.");
      return res.status(404).json({ message: "No payment made found for this supplier." });
  }

  // Check if the provided paymentId matches the latest one
  if (latestPayment._id.toString() !== paymentId) {
    return res.status(400).json({
      message: "Only the latest payment made can be edited."
    });
  }

  return latestPayment;
}



async function returnBalanceAmount(existingPaymentMadeBills) {
  try {
    for (const existingBills of existingPaymentMadeBills) {
      const { billId, payment, amountDue } = existingBills;

      // Find the bill by its ID
      const bill = await Bill.findById(billId);
      if (!bill) {
        console.warn(`Bill not found with ID: ${billId}`);
        continue;
      }

      // Update the bill's paidAmount and balanceAmount
      bill.paidAmount -= payment;
      bill.balanceAmount = amountDue;

      // Save the updated bill
      await bill.save();
      console.log(`Updated Bill ID: ${billId} | Paid Amount: ${bill.paidAmount} | Balance Amount: ${bill.balanceAmount}`);
    }
  } catch (error) {
    console.error("Error updating bill balances:", error);
    throw new Error("Failed to update bill balances");
  }
}






function validateIds({ billIds, supplierId }) {
    // Validate Supplier ID
    if (!mongoose.Types.ObjectId.isValid(supplierId) || supplierId.length !== 24) {
      return res.status(400).json({ message: `Invalid supplier ID: ${supplierId}` });
    }
  
    // Validate Invoice IDs
    const invalidBillIds = billIds.filter(billId => !mongoose.Types.ObjectId.isValid(billId) || billId.length !== 24);
    if (invalidBillIds.length > 0) {
      return res.status(400).json({ message: `Invalid bill IDs: ${invalidBillIds.join(', ')}` });
    }
  
    // Check for duplicate Bill IDs
    const uniqueBillIds = new Set(billIds);
    if (uniqueBillIds.size !== billIds.length) {
      return res.status(400).json({ message: "Duplicate bill found" });
    }
  
    // Return null if all validations pass
    return null;
}





// Utility function to process bill
async function processUnpaidBills(bills, existingPaymentMadeBills) {
  
  const results = [];
  for (const bill of bills) {
    try {
      const result = await calculateAmountDue(bill.billId, { amount: bill.payment }, existingPaymentMadeBills);
      results.push(result);
    } catch (error) {
      console.error(`Error processing Invoice ID: ${bill.billId}`, error);
      throw error; // Re-throw for higher-level error handling
    }
  }
  return results;
}


const calculateAmountDue = async (billId, { amount }, existingPaymentMadeBills) => {
  try {
    // Find the bill by its ID
    const bill = await Bill.findById(billId);

    if (!bill) {
      throw new Error(`Bill not found with ID: ${billId}`);
    }

    // Find the corresponding bill in existingPaymentMadeBills
    const existingBill = existingPaymentMadeBills.find((bill) => bill.billId.toString() === billId.toString());

    if (!existingBill) {
      throw new Error(`No matching bill found in existingPaymentMadeBill for ID: ${billId}`);
    }

    // Initialize fields if undefined
    bill.paidAmount = typeof bill.paidAmount === 'number' ? bill.paidAmount : 0;
    bill.balanceAmount = typeof bill.balanceAmount === 'number' ? bill.balanceAmount : bill.grandTotal;

    // Check if payment and amount are equal
    if (existingBill.payment === amount) {

      bill.balanceAmount = existingBill.amountDue;
      await bill.save();
      console.log(`No changes required for Bill ID ${billId}: payment and amount are equal.`);

    } else {
      
      if (existingBill.payment < amount) {
        // If the incoming amount is greater than the existing payment, increase paidAmount
        const incAmt = amount - existingBill.payment;
        bill.paidAmount += incAmt;
      } else {
        // If the incoming amount is less than the existing payment, decrease paidAmount
        const decAmt = (existingBill.payment - amount);
        bill.paidAmount -= decAmt;
      }

      // Recalculate balanceAmount
      bill.balanceAmount = existingBill.amountDue - amount;

      // Ensure values are within correct bounds
      if (bill.balanceAmount < 0) {
        bill.balanceAmount = 0;
      }
      if (bill.paidAmount > bill.grandTotal) {
        bill.paidAmount = bill.grandTotal;
      }

      await bill.save();
    }

    // Log the updated bill status for debugging
    console.log(`Updated Bill ID ${billId}: Paid Amount: ${bill.paidAmount}, Balance Amount: ${bill.balanceAmount}`);

    // Check if payment is complete
    if (bill.balanceAmount === 0) {
      return {
        message: `Payment completed for Bill ID ${billId}. No further payments are needed.`,
        bill,
      };
    }
    
    return { message: 'Payment processed', billId };

  } catch (error) {
    console.error(`Error calculating balance amount for Bill ID ${billId}:`, error);
    throw new Error(`Error calculating balance amount for Bill ID ${billId}: ${error.message}`);
  }
};








// Field validation utility
function validateField(condition, errorMsg, errors) {
  if (condition) errors.push(errorMsg);
}



//Validate inputs
function validateInputs( cleanedData, unpaidBills, paymentTable, paidThroughAccount, supplierAccount, res) {
  const validationErrors = validatePaymentData(cleanedData, unpaidBills , paymentTable, paidThroughAccount, supplierAccount);

  if (validationErrors.length > 0) {
    res.status(400).json({ message: validationErrors.join(", ") });
    return false;
  }
  return true;
}


//Validate Data
function validatePaymentData( data, unpaidBills, paymentTable, paidThroughAccount, supplierAccount ) {
  const errors = [];
  //Basic Info
  validateReqFields( data, paidThroughAccount, supplierAccount, errors );
  validatePaymentTable(unpaidBills, paymentTable, errors);
  validateFloatFields(['amountPaid','amountUsedForPayments','amountInExcess'], data, errors);
  validatePaymentMode(data.paymentMode, errors);
  return errors;
}


//Valid Req Fields
function validateReqFields( data, paidThroughAccount, supplierAccount, errors ) {
  console.log("paidThroughAccount....................",data)
  


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

    // Validate float fields
    validateFloatFields(['amountDue', 'billAmount', 'payment'], unpaidBill, errors);

  });
}





//Validate inputs
function validateUpdatedInputs(cleanedData, existingPaymentMade, res) {
  const validationErrors = validateBalanceAmtData(cleanedData, existingPaymentMade);

  if (validationErrors.length > 0) {
    res.status(400).json({ message: validationErrors.join(", ") });
    return false;
  }
  return true;
}

//Validate Data
function validateBalanceAmtData( cleanedData, existingPaymentMade ) {
  const errors = [];
  validateAmtDueData(cleanedData, existingPaymentMade, errors);
  return errors;
}

//Function to Validate Amount Due 
function validateAmtDueData(cleanedData, existingPaymentMade, errors) {

  const paymentMadeBill = cleanedData.unpaidBills;
  const existingPaymentBill = existingPaymentMade.unpaidBills;

  // Check if paymentMadeBill and existingPaymentBill are valid arrays
  validateField(!Array.isArray(paymentMadeBill), "Invalid payment made bill data.", errors);
  validateField(!Array.isArray(existingPaymentBill), "Invalid existing payment bill data.", errors);
  if (!Array.isArray(paymentMadeBill) || !Array.isArray(existingPaymentBill)) return;

  validateField( paymentMadeBill.length !== existingPaymentBill.length, "Mismatch in payment made bill count between request and database.", errors  );

  paymentMadeBill.forEach((PBill) => {
    const existingPBill = existingPaymentBill.find(bill => bill.billId.toString() === PBill.billId.toString());

    validateField( !existingPBill, `Bill with ID ${PBill.billId} was not found.`, errors );
    if (!existingPBill) return;

    validateField( PBill.billNumber !== existingPBill.billNumber, `Bill Number Mismatch Payment Made Bill Number: ${existingPBill.billNumber}`, errors );
    validateField( PBill.billDate !== existingPBill.billDate, `Bill Date Mismatch Payment Made Invoice Number: ${PBill.billNumber} : ${existingPBill.billDate}` , errors );
    validateField( PBill.dueDate !== existingPBill.dueDate, `Due Date Mismatch for Payment Made Invoice Number ${PBill.billNumber}:  ${existingPBill.dueDate}`, errors );
    validateField( PBill.billAmount !== existingPBill.billAmount, `Bill Amount for Payment Made Invoice Number ${PBill.billNumber}: ${existingPBill.billAmount}`, errors );
    validateField( PBill.balanceAmount !== existingPBill.balanceAmount, `Amount Due for Payment Made Invoice number ${PBill.billNumber}: ${existingPBill.balanceAmount}`, errors );
  });
}





//Valid Float Fields  
// Validate Payment Mode
function validatePaymentMode(paymentMode, errors) {
  validateField(
    paymentMode && !validation.validPaymentMode.includes(paymentMode),
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










async function journal( savedPaymentMade, paidThroughAccount, supplierAccount ) { 
    

    await TrialBalance.deleteMany({
        organizationId: savedPaymentMade.organizationId,
        operationId: savedPaymentMade._id,
    });

        
    const supplierReceived = {
      organizationId: savedPaymentMade.organizationId,
      operationId: savedPaymentMade._id,
      transactionId: savedPaymentMade.paymentMade,
      accountId: supplierAccount._id || undefined,
      action: "Payment Made",
      debitAmount: savedPaymentMade.amountPaid || 0,
      creditAmount: 0,
      remark: savedPaymentMade.note,
      createdDateTime:savedPaymentMade.createdDateTime
    };
    const paidThroughAcc = {
      organizationId: savedPaymentMade.organizationId,
      operationId: savedPaymentMade._id,
      transactionId: savedPaymentMade.paymentMade,
      accountId: paidThroughAccount._id || undefined,
      action: "Payment Made",
      debitAmount: 0,
      creditAmount: savedPaymentMade.amountPaid || 0,
      remark: savedPaymentMade.note,
      createdDateTime:savedPaymentMade.createdDateTime
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
      createdDateTime: data.createdDateTime
    });
    
    await newTrialEntry.save();
  
}