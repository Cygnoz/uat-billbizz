const CreditNote = require('../../database/model/creditNote');
const Organization = require('../../database/model/organization');
const Invoice = require('../../database/model/salesInvoice');
const Customer = require('../../database/model/customer');
const Item = require('../../database/model/item');
const Settings = require("../../database/model/settings");
const ItemTrack = require("../../database/model/itemTrack");
const Prefix = require("../../database/model/prefix");
const DefAcc  = require("../../database/model/defaultAccount");
const Account = require("../../database/model/account");
const TrialBalance = require("../../database/model/trialBalance");
const CustomerHistory = require("../../database/model/customerHistory");

const moment = require("moment-timezone");

const mongoose = require('mongoose');

const { cleanData } = require("../../services/cleanData");
const { singleCustomDateTime, multiCustomDateTime } = require("../../services/timeConverter");

// Fetch existing data
const dataExist = async ( organizationId, customerId, invoiceId ) => {
    const [organizationExists, customerExist, invoiceExist, settings, existingPrefix, defaultAccount, customerAccount ] = await Promise.all([
      Organization.findOne({ organizationId }, { organizationId: 1, organizationCountry: 1, state: 1, timeZoneExp: 1 }),
      Customer.findOne({ organizationId , _id:customerId}, { _id: 1, customerDisplayName: 1, taxType: 1 }),
      Invoice.findOne({ organizationId, _id:invoiceId }, { _id: 1, salesInvoice: 1, salesInvoiceDate: 1, salesOrderNumber: 1, customerId: 1, placeOfSupply: 1, items: 1 }),
      Settings.findOne({ organizationId }),
      Prefix.findOne({ organizationId }),
      DefAcc.findOne({ organizationId },{ outputCgst: 1, outputSgst: 1, outputIgst: 1 ,outputVat: 1 }),
      Account.findOne({ organizationId , accountId:customerId },{ _id:1, accountName:1 })
    ]);    
  return { organizationExists, customerExist, invoiceExist, settings, existingPrefix, defaultAccount, customerAccount };
};



// Fetch Acc existing data
const accDataExists = async ( organizationId, paidThroughAccountId ) => {
  const [ paidAccount ] = await Promise.all([
    Account.findOne({ organizationId , _id: paidThroughAccountId, accountHead: "Asset" }, { _id:1, accountName: 1 }),
  ]);
  return { paidAccount };};



//Fetch Item Data
const itemDataExists = async (organizationId,items) => {
  // Retrieve items with specified fields
  const itemIds = items.map(item => new mongoose.Types.ObjectId(item.itemId));


  const [newItems] = await Promise.all([
    Item.find( { organizationId, _id: { $in: itemIds } },
    { _id: 1, itemName: 1, taxPreference: 1, sellingPrice: 1, costPrice: 1, returnableItem: 1, taxRate: 1, cgst: 1, sgst: 1, igst: 1, vat: 1 }
    ).lean()
  ]);

  // Aggregate ItemTrack data to calculate current stock
  const itemTracks = await ItemTrack.aggregate([
    { $match: { itemId: { $in: itemIds } } },
    {
        $group: {
            _id: "$itemId",
            totalCredit: { $sum: "$creditQuantity" },
            totalDebit: { $sum: "$debitQuantity" },
            lastEntry: { $max: "$createdDateTime" } // Capture the latest entry time for each item
        }
    }
  ]);

  // Map itemTracks for easier lookup
  const itemTrackMap = itemTracks.reduce((acc, itemTrack) => {
      acc[itemTrack._id.toString()] = {
          currentStock: itemTrack.totalDebit - itemTrack.totalCredit, // Calculate stock as debit - credit
          lastEntry: itemTrack.lastEntry
      };
      return acc;
    }, {});

  // Enrich newItems with currentStock data
  const itemTable = newItems.map(item => ({
      ...item,
      currentStock: itemTrackMap[item._id.toString()]?.currentStock ?? 0, // Use 0 if no track data
      // lastEntry: itemTrackMap[item._id.toString()]?.lastEntry || null // Include the latest entry timestamp
  }));

return { itemTable };
};


const creditDataExist = async ( organizationId, creditId ) => {    
  const [organizationExists, allCreditNote, creditNote, creditJournal ] = await Promise.all([
    Organization.findOne({ organizationId }, { timeZoneExp: 1, dateFormatExp: 1, dateSplit: 1, organizationCountry: 1 }),
    CreditNote.find({ organizationId },{ organizationId: 0,})
    .populate('customerId', 'customerDisplayName')
    .lean(),
    CreditNote.findOne({ organizationId , _id: creditId })
    .populate('items.itemId', 'itemName')
    .populate('customerId', 'customerDisplayName')
    .lean(),
    TrialBalance.find({ organizationId: organizationId, operationId : creditId })
    .populate('accountId', 'accountName')    
    .lean(),
  ]);
  return { organizationExists, allCreditNote, creditNote, creditJournal };
};



// Add credit note
exports.addCreditNote = async (req, res) => {
  console.log("Add credit note:", req.body);
  try {
    const { organizationId, id: userId, userName } = req.user;

    //Clean Data
    const cleanedData = cleanData(req.body);
    cleanedData.items = cleanedData.items?.map(data => cleanData(data)) || [];

    cleanedData.items = cleanedData.items
      ?.map(data => cleanData(data))
      .filter(item => item.itemId !== undefined && item.itemId !== '') || []; 


    const { items, customerId, invoiceId } = cleanedData;    
    const itemIds = items.map(item => item.itemId);
    
    // Check for duplicate itemIds
    const uniqueItemIds = new Set(itemIds);
    if (uniqueItemIds.size !== itemIds.length) {
      return res.status(400).json({ message: "Duplicate Item found" });
    }

    //Validate Customer
    if (!mongoose.Types.ObjectId.isValid(customerId) || customerId.length !== 24) {
      return res.status(400).json({ message: `Invalid customer ID: ${customerId}` });
    }

    //Validate invoice
    if (!mongoose.Types.ObjectId.isValid(invoiceId) || invoiceId.length !== 24) {
      return res.status(400).json({ message: `Invalid Invoice ID: ${invoiceId}` });
    }

    // Validate ItemIds
    const invalidItemIds = itemIds.filter(itemId => !mongoose.Types.ObjectId.isValid(itemId) || itemId.length !== 24);
    if (invalidItemIds.length > 0) {
      return res.status(400).json({ message: `Invalid item IDs: ${invalidItemIds.join(', ')}` });
    }   

    const { organizationExists, customerExist, invoiceExist, existingPrefix, defaultAccount, customerAccount } = await dataExist( organizationId, customerId, invoiceId );

    
    //Data Exist Validation
    if (!validateOrganizationTaxCurrency( organizationExists, customerExist, invoiceExist, existingPrefix, res )) return;
    
    const { itemTable } = await itemDataExists( organizationId, items );   
    
    //Validate Inputs  
    if (!validateInputs( cleanedData, customerExist, invoiceExist, items, itemTable, organizationExists, res)) return;
    
    //Tax Type
    taxType(cleanedData, customerExist, organizationExists );
    
    //Default Account
    const { defAcc, paidThroughAccount, error } = await defaultAccounting( cleanedData, defaultAccount, organizationExists );
    if (error) { 
      res.status(400).json({ message: error }); 
      return false; 
    }
    
    // Calculate Credit Note 
    if (!calculateCreditNote( cleanedData, res )) return;

    //Sales Journal      
    if (!salesJournal( cleanedData, res )) return; 

    //Prefix
    await creditNotePrefix(cleanedData, existingPrefix );

    cleanedData.createdDateTime = moment.tz(cleanedData.customerCreditDate, "YYYY-MM-DDTHH:mm:ss.SSS[Z]", organizationExists.timeZoneExp).toISOString();           

    const savedCreditNote = await createNewCreditNote(cleanedData, organizationId, userId, userName );

    // Add entry to Customer History
    const customerHistoryEntry = new CustomerHistory({
      organizationId,
      operationId: savedCreditNote._id,
      customerId,
      title: "Credit Note Added",
      description: `Credit Note ${savedCreditNote.creditNote} of amount ${savedCreditNote.totalAmount} created by ${userName}`,
      userId: userId,
      userName: userName,
    });

    await customerHistoryEntry.save();

    //Journal
    await journal( savedCreditNote, defAcc, customerAccount, paidThroughAccount );

    //Item Track
    await itemTrack( savedCreditNote, itemTable );

    // Update Sales Invoice
    await updateSalesInvoiceWithCreditNote(invoiceId, items);

    //Update Invoice Balance
    await updateSalesInvoiceBalance( savedCreditNote, invoiceId ); 
    
    // Calculate stock 
    await calculateStock(savedCreditNote);
      
    res.status(201).json({ message: "Credit Note created successfully",savedCreditNote });
    console.log( "Credit Note created successfully:", savedCreditNote );
  } catch (error) {
    console.error("Error Creating Credit Note:", error);
    res.status(500).json({ message: "Internal server error." });
  }
}



// Get All Credit Note
exports.getAllCreditNote = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    const { organizationExists, allCreditNote } = await creditDataExist( organizationId, null );

    if (!organizationExists) return res.status(404).json({ message: "Organization not found" });
    

    if (!allCreditNote) return res.status(404).json({ message: "No Debit Note found" });
    

    const transformedInvoice = allCreditNote.map(data => {
      return {
          ...data,
          customerId: data.customerId?._id,  
          customerDisplayName: data.customerId?.customerDisplayName,  
      };});


    // Process and filter credit notes using the helper function
    // const updatedCreditNotes = await Promise.all(
    //   transformedInvoice.map((creditNote) => calculateStock(creditNote))
    // );

    const formattedObjects = multiCustomDateTime(transformedInvoice, organizationExists.dateFormatExp, organizationExists.timeZoneExp, organizationExists.dateSplit );    


    res.status(200).json(formattedObjects);
  } catch (error) {
    console.error("Error fetching credit note:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};


// Get One Credit Note
exports.getOneCreditNote = async (req, res) => {
try {
  const organizationId = req.user.organizationId;
  const creditId = req.params.creditId;

  const { organizationExists, creditNote } = await creditDataExist(organizationId, creditId);

  if (!organizationExists) return res.status(404).json({ message: "Organization not found" });

  if (!creditNote) return res.status(404).json({ message: "No Debit Note found" });

  const transformedData = {
    ...creditNote,
    customerId: creditNote.customerId?._id,  
    customerDisplayName: creditNote.customerId?.customerDisplayName,
    items: creditNote.items.map(item => ({
      ...item,
      itemId: item.itemId?._id,
      itemName: item.itemId?.itemName,
    })),  
};

const formattedObjects = singleCustomDateTime(transformedData, organizationExists.dateFormatExp, organizationExists.timeZoneExp, organizationExists.dateSplit );    

  
  res.status(200).json(formattedObjects);
} catch (error) {
  console.error("Error fetching credit note:", error);
  res.status(500).json({ message: "Internal server error."});
}
};




// Get Credit Note Journal
exports.creditNoteJournal = async (req, res) => {
  try {
      const organizationId = req.user.organizationId;
      const { creditId } = req.params;

      const { creditJournal } = await creditDataExist( organizationId, creditId );      

      if (!creditJournal) {
          return res.status(404).json({
              message: "No Journal found for the Invoice.",
          });
      }

      const transformedJournal = creditJournal.map(item => {
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





// Get last credit note prefix
exports.getLastCreditNotePrefix = async (req, res) => {
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
      const lastPrefix = series.creditNote + series.creditNoteNum;

      lastPrefix.organizationId = undefined;

      res.status(200).json(lastPrefix);
  } catch (error) {
      console.error("Error fetching accounts:", error);
      res.status(500).json({ message: "Internal server error." });
  }
};








// Credit Note Prefix
function creditNotePrefix( cleanData, existingPrefix ) {
  const activeSeries = existingPrefix.series.find(series => series.status === true);
  if (!activeSeries) {
      return res.status(404).json({ message: "No active series found for the organization." });
  }
  cleanData.creditNote = `${activeSeries.creditNote}${activeSeries.creditNoteNum}`;

  activeSeries.creditNoteNum += 1;

  existingPrefix.save()
}




// Create New Credit Note
function createNewCreditNote( data, organizationId, userId, userName ) {
  const newCreditNote = new CreditNote({ ...data, organizationId, userId, userName });
  return newCreditNote.save();
}






// Validate Organization Customer Invoice Prefix
function validateOrganizationTaxCurrency( organizationExists, customerExist, invoiceExist, existingPrefix, res ) {
  if (!organizationExists) {
    res.status(404).json({ message: "Organization not found" });
    return false;
  }
  if (!customerExist) {
    res.status(404).json({ message: "Customer not found." });
    return false;
  }
  if (!invoiceExist) {
    res.status(404).json({ message: "Invoice not found" });
    return false;
  }
  if (!existingPrefix) {
    res.status(404).json({ message: "Prefix not found" });
    return false;
  }
  return true;
}





// Tax Type
function taxType( cleanedData, customerExist, organizationExists ) {
  if(customerExist.taxType === 'GST' ){
    if(cleanedData.placeOfSupply === organizationExists.state){
      cleanedData.taxType ='Intra';
    }
    else{
      cleanedData.taxType ='Inter';
    }
  }
  if(customerExist.taxType === 'VAT' ){
    cleanedData.taxType ='VAT';
  }
  if(customerExist.taxType === 'Non-Tax' ){
    cleanedData.taxType ='Non-Tax';
  }  
}




//Default Account
async function defaultAccounting(data, defaultAccount, organizationExists) {

  // 1. Fetch required accounts
  const accounts = await accDataExists( organizationExists.organizationId, data.paidThroughAccountId );
  
  // 2. Check for missing required accounts
  const errorMessage = getMissingAccountsError(data, defaultAccount, accounts);
  if (errorMessage) {
    return { defAcc: null, error: errorMessage };
  }  
  
  return { defAcc: defaultAccount, paidThroughAccount: accounts, error: null };
}

function getMissingAccountsError(data, defaultAccount, accounts) {
  const accountChecks = [
    // Tax account checks
    { condition: data.cgst, account: defaultAccount.outputCgst, message: "CGST Account" },
    { condition: data.sgst, account: defaultAccount.outputSgst, message: "SGST Account" },
    { condition: data.igst, account: defaultAccount.outputIgst, message: "IGST Account" },
    { condition: data.vat, account: defaultAccount.outputVat, message: "VAT Account" },
    
    // Transaction account checks
    { condition: data.paidAmount, account: accounts.paidAccount, message: "Paid Through Account" }
  ];

  const missingAccounts = accountChecks
    .filter(({ condition, account }) => condition && !account)
    .map(({ message }) => `${message} not found`);

  return missingAccounts.length ? missingAccounts.join(". ") : null;
}
















function salesJournal(cleanedData, res) {
  const errors = [];
  const roundToTwoDecimals = (value) => Number(value.toFixed(2));
  const accountEntries = {};


  cleanedData.items.forEach(item => {
          
          const accountId = item.salesAccountId;

          if (!accountId) {
            console.log(`Sales Account not found for item ${item.itemName}`);
            

            errors.push({
              message: `Sales Account not found for item ${item.itemName}`,
            });
            return; 
          }
    
          const debitAmount = roundToTwoDecimals(item.sellingPrice * item.quantity);

          if (!accountEntries[accountId]) {
            accountEntries[accountId] = { accountId, debitAmount: 0 };
          }
          // Accumulate the debit amount
          accountEntries[accountId].debitAmount += debitAmount;
  });

  // Push the grouped entries into cleanedData.journal
  cleanedData.salesJournal = Object.values(accountEntries);
    
  // Handle response or further processing
  if (errors.length > 0) {
    res.status(400).json({ success: false, message:"Sales journal error", errors });
    return false;
  }
  return true;
}



























function calculateCreditNote(cleanedData, res) {
  const errors = [];

  let subTotal = 0;
  let totalTax = 0;
  let totalItem = 0;
  let totalAmount = 0;

  // Utility function to round values to two decimal places
  const roundToTwoDecimals = (value) => Number(value.toFixed(2));  

  cleanedData.items.forEach(item => {

    let calculatedCgstAmount = 0;
    let calculatedSgstAmount = 0;
    let calculatedIgstAmount = 0;
    let calculatedVatAmount = 0;
    let calculatedTaxAmount = 0;
    let itemAmount = 0;
    let taxType = cleanedData.taxType;

    totalItem +=  parseInt(item.quantity);
    subTotal += parseFloat(item.quantity * item.sellingPrice);

    let withoutTaxAmount = (item.sellingPrice * item.quantity);

    // Handle tax calculation only for taxable items
    if (item.taxPreference === 'Taxable') {
      switch (taxType) {
        
        case 'Intra':
          calculatedCgstAmount = roundToTwoDecimals((item.cgst / 100) * withoutTaxAmount);
          calculatedSgstAmount = roundToTwoDecimals((item.sgst / 100) * withoutTaxAmount);
        break;

        case 'Inter':
          calculatedIgstAmount = roundToTwoDecimals((item.igst / 100) * withoutTaxAmount);
        break;
        
        case 'VAT':
          calculatedVatAmount = roundToTwoDecimals((item.vat / 100) * withoutTaxAmount);
        break;

      }

      calculatedTaxAmount =  calculatedCgstAmount + calculatedSgstAmount + calculatedIgstAmount + calculatedVatAmount;
      
      // Check tax amounts
      checkAmount(calculatedCgstAmount, item.cgstAmount, item.itemName, 'CGST',errors);
      checkAmount(calculatedSgstAmount, item.sgstAmount, item.itemName, 'SGST',errors);
      checkAmount(calculatedIgstAmount, item.igstAmount, item.itemName, 'IGST',errors);
      checkAmount(calculatedVatAmount, item.vatAmount, item.itemName, 'VAT',errors);
      checkAmount(calculatedTaxAmount, item.itemTotalTax, item.itemName, 'Item tax',errors);

      totalTax += calculatedTaxAmount;     

    } else {
      console.log(`Skipping Tax for Non-Taxable item: ${item.itemName}`);
    }

    itemAmount = (withoutTaxAmount + calculatedTaxAmount);

    checkAmount(itemAmount, item.itemAmount, item.itemName, 'Item Total',errors);

    console.log(`${item.itemName} Item Total: ${itemAmount} , Provided ${item.itemAmount}`);
    console.log(`${item.itemName} Total Tax: ${calculatedTaxAmount} , Provided ${item.itemTotalTax || 0 }`);
    console.log("");
  });

  const total = ((parseFloat(subTotal) + parseFloat(totalTax)));

  console.log(`SubTotal: ${subTotal} , Provided ${cleanedData.subTotal}`);
 
  totalAmount = total; 

  // Round the totals for comparison
  const roundedSubTotal = roundToTwoDecimals(subTotal); 
  const roundedTotalTax = roundToTwoDecimals(totalTax);
  const roundedTotalAmount = roundToTwoDecimals(totalAmount);

  console.log(`Final Sub Total: ${roundedSubTotal} , Provided ${cleanedData.subTotal}` );
  console.log(`Final Total Tax: ${roundedTotalTax} , Provided ${cleanedData.totalTax}` );
  console.log(`Final Total Amount: ${roundedTotalAmount} , Provided ${cleanedData.totalAmount}` );

  validateAmount(roundedSubTotal, cleanedData.subTotal, 'SubTotal', errors);
  validateAmount(roundedTotalTax, cleanedData.totalTax, 'Total Tax Amount', errors);
  validateAmount(roundedTotalAmount, cleanedData.totalAmount, 'Grand Total', errors);
  validateAmount(totalItem, cleanedData.totalItem, 'Total Item count', errors);

  if (errors.length > 0) {
    res.status(400).json({ message: errors.join(", ") });
    return false;
  }

  return true;
}



//Mismatch Check
function checkAmount(calculatedAmount, providedAmount, itemName, taxType, errors) {
  const roundToTwoDecimals = (value) => Number(value.toFixed(2)); // Round to two decimal places
  const roundedAmount = roundToTwoDecimals(calculatedAmount);
  console.log(`Item: ${itemName}, Calculated ${taxType}: ${roundedAmount}, Provided data: ${providedAmount}`);

  if (Math.abs(roundedAmount - providedAmount) > 0.01) {
    const errorMessage = `Mismatch in ${taxType} for item ${itemName}: Calculated ${calculatedAmount}, Provided ${providedAmount}`;
    errors.push(errorMessage);
    console.log(errorMessage);
  }
}


//Final Item Amount check
const validateAmount = ( calculatedValue, cleanedValue, label, errors ) => {
  const isCorrect = calculatedValue === parseFloat(cleanedValue);
  if (!isCorrect) {
    const errorMessage = `${label} is incorrect: ${cleanedValue}`;
    errors.push(errorMessage);
    console.log(errorMessage);
  }
};







//Validate inputs
function validateInputs( data, customerExist, invoiceExist, items, itemExists, organizationExists, res) {

  const validationErrors = validateCreditNoteData(data, customerExist, invoiceExist, items, itemExists, organizationExists);  

  if (validationErrors.length > 0) {
    res.status(400).json({ message: validationErrors.join(", ") });
    return false;
  }
  return true;
}

//Validate Data
function validateCreditNoteData( data, customerExist, invoiceExist, items, itemTable, organizationExists ) {
  
  const errors = [];
  
  
  //Basic Info
  validateReqFields( data, customerExist, errors );
  validateItemTable(items, itemTable, errors);
  validateInvoiceData(data, items, invoiceExist, errors);


  
  //OtherDetails
  validateIntegerFields(['totalItem'], data, errors);
  validateFloatFields(['subTotal','cgst','sgst','igst','vat','totalTax','totalAmount'], data, errors);
  //validateAlphabetsFields(['department', 'designation'], data, errors);
  
  //Tax Details
  //validateTaxType(data.taxType, validTaxTypes, errors);
  validatePlaceOfSupply(data.placeOfSupply, organizationExists, errors);
  validateInvoiceType(data.invoiceType, errors);
  validatePaymentMode(data.paymentMode, errors);
  //validateGSTorVAT(data, errors);

  return errors;
}



// Field validation utility
function validateField(condition, errorMsg, errors) {
  if (condition) errors.push(errorMsg);
}


//Valid Req Fields
function validateReqFields( data, customerExist, errors ) {
  validateField( typeof data.customerId === 'undefined' , "Please select a customer", errors  );
  validateField( typeof data.customerCreditDate === 'undefined' , "Please select customer credit Date", errors  );
  validateField( customerExist.taxType == 'GST' && typeof data.placeOfSupply === 'undefined', "Place of supply is required", errors  );
  
  validateField( typeof data.items === 'undefined', "Select an item", errors  );
  validateField( Array.isArray(data.items) && data.items.length === 0, "Select an item", errors );
  
  validateField( data.invoiceNumber === 'undefined', "Select an invoice number", errors  );
  validateField( typeof data.paymentMode === 'undefined', "Select payment mode", errors  );
  validateField( data.paymentMode === 'Cash' && typeof data.totalAmount === 'undefined', "Enter the amount paid", errors  );
  validateField( data.paymentMode === 'Cash' && typeof data.paidThroughAccountId === 'undefined', "Select an paid through account", errors  );  
}


// Function to Validate Item Table 
function validateItemTable(items, itemTable, errors) {
  
  // Check for item count mismatch
  validateField( items.length !== itemTable.length, "Mismatch in item count between request and database.", errors  );
  
  // Iterate through each item to validate individual fields
  items.forEach((item) => {
    const fetchedItem = itemTable.find(it => it._id.toString() === item.itemId);


    validateField( fetchedItem.returnableItem !== true, "Non-returnable items found. Credit note can only be added for returnable items.", errors );
  
    // Check if item exists in the item table
    validateField( !fetchedItem, `Item with ID ${item.itemId} was not found.`, errors );
    if (!fetchedItem) return; 
  
    // Validate item name
    // validateField( item.itemName !== fetchedItem.itemName, `Item Name Mismatch : ${item.itemName}`, errors );
  
    // Validate selling price
    // validateField( item.sellingPrice !== fetchedItem.sellingPrice, `Cost price Mismatch for ${item.itemName}:  ${item.sellingPrice}`, errors );
  
    // Validate CGST
    validateField(
      fetchedItem.cgst !== undefined && fetchedItem.cgst !== 0 && Number(item.cgst) !== Number(fetchedItem.cgst),
      `CGST Mismatch for ${item.itemName}: ${item.cgst}`,
      errors
    );
  
    // Validate SGST
    validateField(
      fetchedItem.sgst !== undefined && fetchedItem.sgst !== 0 && Number(item.sgst) !== Number(fetchedItem.sgst),
      `SGST Mismatch for ${item.itemName}: ${item.sgst}`,
      errors
    );  
    // Validate IGST
    validateField(
      fetchedItem.igst !== undefined && fetchedItem.igst !== 0 && Number(item.igst) !== Number(fetchedItem.igst),
      `IGST Mismatch for ${item.itemName}: ${item.igst}`,
      errors
    );
    //Validate VAT
    validateField(
      fetchedItem.vat !== undefined && fetchedItem.vat !== 0 && Number(item.vat) !== Number(fetchedItem.vat),
      `VAT Mismatch for ${item.itemName}: ${item.vat}`,
      errors
    );  
    // Validate tax preference
    validateField( item.taxPreference !== fetchedItem.taxPreference, `Tax Preference mismatch for ${item.itemName}: ${item.taxPreference}`, errors );
  
    // Validate integer fields
    validateIntegerFields(['itemQuantity'], item, errors);
    
    // Validate float fields
    validateFloatFields(['sellingPrice', 'itemTotalTax', 'itemAmount'], item, errors); 
  });
  }



  // validate invoice data
function validateInvoiceData(data, items, invoiceExist, errors) {  

   // Initialize `invoiceExist.items` to an empty array if undefined
  //  invoiceExist.items = Array.isArray(invoiceExist.items) ? invoiceExist.items : [];


  // Validate basic fields
  // validateField( invoiceExist.salesInvoiceDate !== data.invoiceDate, `Invoice Date mismatch for ${invoiceExist.salesInvoiceDate}`, errors  );
  // validateField( invoiceExist.salesOrderNumber !== data.orderNumber, `Order Number mismatch for ${invoiceExist.salesOrderNumber}`, errors  );
  // validateField( invoiceExist.salesInvoice !== data.invoiceNumber, `Order Number mismatch for ${invoiceExist.salesInvoice}`, errors  );


  // Validate only the items included in the credit note
  items.forEach(CNItem => {
    const invoiceItem = invoiceExist.items.find((item) => item.itemId.toString() === CNItem.itemId);

    // const invoiceExistItem = invoiceExist.items.find(item => item);
    // const invoiceItem = invoiceExistItem.itemId.toString();



    if (!invoiceItem) {
      errors.push(`Item ID ${CNItem.itemId} not found in the invoice.`); 
    } else {
      // validateField(CNItem.itemName !== invoiceItem.itemName, 
      //               `Item Name mismatch for ${invoiceItem.itemId}: Expected ${invoiceItem.itemName}, got ${CNItem.itemName}`, 
      //               errors);
      validateField(CNItem.sellingPrice !== invoiceItem.sellingPrice, 
                    `Item selling price mismatch for ${invoiceItem.itemId}: Expected ${invoiceItem.sellingPrice}, got ${CNItem.sellingPrice}`, 
                    errors);
      validateField(CNItem.cgst !== invoiceItem.cgst, 
                    `Item CGST mismatch for ${invoiceItem.itemId}: Expected ${invoiceItem.cgst}, got ${CNItem.cgst}`, 
                    errors);
      validateField(CNItem.sgst !== invoiceItem.sgst, 
                    `Item SGST mismatch for ${invoiceItem.itemId}: Expected ${invoiceItem.sgst}, got ${CNItem.sgst}`, 
                    errors);
      validateField(CNItem.igst !== invoiceItem.igst, 
                    `Item IGST mismatch for ${invoiceItem.itemId}: Expected ${invoiceItem.igst}, got ${CNItem.igst}`, 
                    errors);
      if (invoiceItem.returnQuantity === 0) {
        validateField(CNItem.stock !== invoiceItem.quantity, 
                    `Stock mismatch for ${invoiceItem.itemId}: Expected ${invoiceItem.quantity}, got ${CNItem.stock}`, 
                    errors);
      } else {
        const expectedReturnQuantity = invoiceItem.quantity - invoiceItem.returnQuantity;
        validateField(CNItem.stock !== expectedReturnQuantity, 
                    `Stock mismatch for ${invoiceItem.itemId}: Expected ${expectedReturnQuantity}, got ${CNItem.stock}`, 
                    errors);
      }
      validateField(CNItem.quantity > invoiceItem.quantity, 
                    `Provided quantity (${CNItem.quantity}) cannot exceed invoice quantity (${invoiceItem.quantity}).`, 
                    errors);
      validateField(CNItem.quantity <= 0, 
                    `Quantity must be greater than 0 for item ${CNItem.itemId}.`, 
                    errors);
      validateField(CNItem.quantity > CNItem.stock, 
                    `Provided quantity (${CNItem.quantity}) cannot exceed stock available (${CNItem.stock}) for item ${CNItem.itemId}.`, 
                    errors);
    }
  });

}



// Validate Place Of Supply
function validatePlaceOfSupply(placeOfSupply, organization, errors) {
  validateField(
    placeOfSupply && !validCountries[organization.organizationCountry]?.includes(placeOfSupply),
    "Invalid Place of Supply: " + placeOfSupply, errors );
}

// Validate Invoice Type
function validateInvoiceType(invoiceType, errors) {
  validateField(
    invoiceType && !validInvoiceType.includes(invoiceType),
    "Invalid Invoice Type: " + invoiceType, errors );
}


// Validate Payment Mode
function validatePaymentMode(paymentMode, errors) {
  validateField(
    paymentMode && !validPaymentMode.includes(paymentMode),
    "Invalid Payment Mode: " + paymentMode, errors );
}



//Valid Alphanumeric Fields
function validateAlphanumericFields(fields, data, errors) {
  fields.forEach((field) => {
    validateField(data[field] && !isAlphanumeric(data[field]), "Invalid " + field + ": " + data[field], errors);
  });
}
// Validate Integer Fields
function validateIntegerFields(fields, data, errors) {
fields.forEach(field => {
  validateField(data[field] && !isInteger(data[field]), `Invalid ${field}: ${data[field]}`, errors);
});
}
//Valid Float Fields  
function validateFloatFields(fields, data, errors) {
  fields.forEach((balance) => {
    validateField(data[balance] && !isFloat(data[balance]),
      "Invalid " + balance.replace(/([A-Z])/g, " $1") + ": " + data[balance], errors);
  });
}
//Valid Alphabets Fields 
function validateAlphabetsFields(fields, data, errors) {
  fields.forEach((field) => {
    if (data[field] !== undefined) {
      validateField(!isAlphabets(data[field]),
        field.charAt(0).toUpperCase() + field.slice(1) + " should contain only alphabets.", errors);
    }
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
  
  function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
  



  // Item Track Function
  async function itemTrack(savedCreditNote, itemTable) {
    const { items } = savedCreditNote;

  
    for (const item of items) {
      const matchingItem = itemTable.find((entry) => 
        entry._id.toString() === item.itemId.toString() 
      );
  
      if (!matchingItem) {
        console.error(`Item with ID ${item.itemId} not found in itemTable`);
        continue; 
      }
    
  
      // Create a new entry for item tracking
      const newTrialEntry = new ItemTrack({
        organizationId: savedCreditNote.organizationId,
        operationId: savedCreditNote._id,
        transactionId: savedCreditNote.creditNote,
        action: "Credit Note",
        itemId: matchingItem._id,
        sellingPrice: matchingItem.sellingPrice || 0,
        costPrice: matchingItem.costPrice || 0, 
        debitQuantity: item.quantity,
        createdDateTime: savedCreditNote.createdDateTime  
      });  

      await newTrialEntry.save();
  
    }
  }



// Function to update salesInvoice with returnQuantity
const updateSalesInvoiceWithCreditNote = async (invoiceId, items) => {
  try {
    for (const item of items) {
      await Invoice.findOneAndUpdate(
        { _id: invoiceId, 'items.itemId': item.itemId },
        {
          $inc: { 'items.$.returnQuantity': item.quantity } 
        }
      );

      // If the itemId was not found and updated, add a new entry
      await Invoice.findOneAndUpdate(
        { _id: invoiceId, 'items.itemId': { $ne: item.itemId } },
        {
          $push: {
            items: {
              returnQuantity: item.quantity
            }
          }
        }
      );
    }
  } catch (error) {
    console.error("Error updating salesInvoice with returnQuantity:", error);
    throw new Error("Failed to update Sales Invoice with Credit Note details.");
  }
};






// Function to update salesInvoice balance
const updateSalesInvoiceBalance = async (savedCreditNote, invoiceId) => {
  try {
    const { totalAmount } = savedCreditNote;
    const invoice = await Invoice.findOne({ _id: invoiceId });
    let newBalance = invoice.balanceAmount - totalAmount; 
    if (newBalance < 0) {
      newBalance = 0;
    }
    console.log(`Updating salesInvoice balance: ${newBalance}, Total Amount: ${totalAmount}, Old Balance: ${invoice.balanceAmount}`);
    
    await Invoice.findOneAndUpdate({ _id: invoiceId }, { $set: { balanceAmount: newBalance } });
  } catch (error) {
    console.error("Error updating salesInvoice balance:", error);
    throw new Error("Failed to update Sales Invoice balance.");
  }
};










// Helper function to calculate stock
const calculateStock = async (creditNote) => {
  try {
    const { invoiceId, items } = creditNote;

    // Fetch corresponding invoice
    const salesInvoice = await Invoice.findById(invoiceId);
    const stockData = [];

    if (salesInvoice) {
      items.forEach((creditItem) => {
        const invoiceItem = salesInvoice.items.find(
          (item) => item.itemId.toString() === creditItem.itemId.toString()
        );

        const stock = invoiceItem ? Math.max(invoiceItem.quantity - invoiceItem.returnQuantity) : 0;        

        stockData.push({ itemId: creditItem.itemId, stock });
      });
    }

    return stockData; // Return computed values without modifying current CreditNote 
  } catch (error) {
    console.error("Error in calculateStock:", error);
    throw new Error("Failed to calculate stock for Credit Note.");
  }
};








  // Utility functions
const validPaymentMode = [ "Cash", "Credit" ]
const validInvoiceType = [
  "Registered", 
  "Deemed Export", 
  "SEZ With Payment", 
  "SEZ Without Payment", 
  "SEZ Without Payment", 
  "Export With Payment", 
  "Export Without Payment", 
  "B2C (Large)", "B2C Others"
];
const validCountries = {
  "United Arab Emirates": [
    "Abu Dhabi",
    "Dubai",
    "Sharjah",
    "Ajman",
    "Umm Al-Quwain",
    "Fujairah",
    "Ras Al Khaimah",
  ],
  "India": [
    "Andaman and Nicobar Island",
    "Andhra Pradesh",
    "Arunachal Pradesh",
    "Assam",
    "Bihar",
    "Chandigarh",
    "Chhattisgarh",
    "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi",
    "Goa",
    "Gujarat",
    "Haryana",
    "Himachal Pradesh",
    "Jammu and Kashmir",
    "Jharkhand",
    "Karnataka",
    "Kerala",
    "Ladakh",
    "Lakshadweep",
    "Madhya Pradesh",
    "Maharashtra",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Odisha",
    "Puducherry",
    "Punjab",
    "Rajasthan",
    "Sikkim",
    "Tamil Nadu",
    "Telangana",
    "Tripura",
    "Uttar Pradesh",
    "Uttarakhand",
    "West Bengal",
  ],
  "Saudi Arabia": [
    "Asir",
    "Al Bahah",
    "Al Jawf",
    "Al Madinah",
    "Al-Qassim",
    "Eastern Province",
    "Hail",
    "Jazan",
    "Makkah",
    "Medina",
    "Najran",
    "Northern Borders",
    "Riyadh",
    "Tabuk",
  ],
};































async function journal( savedCreditNote, defAcc, customerAccount, paidThroughAccount ) {  
  const cgst = {
    organizationId: savedCreditNote.organizationId,
    operationId: savedCreditNote._id,
    transactionId: savedCreditNote.creditNote,
    date: savedCreditNote.createdDate,
    accountId: defAcc.outputCgst || undefined,
    action: "Sales Return",
    debitAmount: savedCreditNote.cgst || 0,
    creditAmount:  0,
    remark: savedCreditNote.note,
    createdDateTime:savedCreditNote.createdDateTime
  };
  const sgst = {
    organizationId: savedCreditNote.organizationId,
    operationId: savedCreditNote._id,
    transactionId: savedCreditNote.creditNote,
    date: savedCreditNote.createdDate,
    accountId: defAcc.outputSgst || undefined,
    action: "Sales Return",
    debitAmount: savedCreditNote.sgst || 0,
    creditAmount: 0,
    remark: savedCreditNote.note,
    createdDateTime:savedCreditNote.createdDateTime
  };
  const igst = {
    organizationId: savedCreditNote.organizationId,
    operationId: savedCreditNote._id,
    transactionId: savedCreditNote.creditNote,
    date: savedCreditNote.createdDate,
    accountId: defAcc.outputIgst || undefined,
    action: "Sales Return",
    debitAmount: savedCreditNote.igst || 0,
    creditAmount: 0,
    remark: savedCreditNote.note,
    createdDateTime:savedCreditNote.createdDateTime
  };
  const vat = {
    organizationId: savedCreditNote.organizationId,
    operationId: savedCreditNote._id,
    transactionId: savedCreditNote.creditNote,
    date: savedCreditNote.createdDate,
    accountId: defAcc.outputVat || undefined,
    action: "Sales Return",
    debitAmount: savedCreditNote.vat || 0,
    creditAmount: 0,
    remark: savedCreditNote.note,
    createdDateTime:savedCreditNote.createdDateTime
  };
  const customerCredit = {
    organizationId: savedCreditNote.organizationId,
    operationId: savedCreditNote._id,
    transactionId: savedCreditNote.creditNote,
    date: savedCreditNote.createdDate,
    accountId: customerAccount._id || undefined,
    action: "Sales Return",
    debitAmount: 0,
    creditAmount: savedCreditNote.totalAmount || 0,
    remark: savedCreditNote.note,
    createdDateTime:savedCreditNote.createdDateTime
  };
  
  const customerReceived = {
    organizationId: savedCreditNote.organizationId,
    operationId: savedCreditNote._id,
    transactionId: savedCreditNote.creditNote,
    date: savedCreditNote.createdDate,
    accountId: customerAccount._id || undefined,
    action: "Credit Note",
    debitAmount: savedCreditNote.totalAmount || 0,
    creditAmount: 0,
    remark: savedCreditNote.note,
    createdDateTime:savedCreditNote.createdDateTime
  };
  const paidThroughAccounts = {
    organizationId: savedCreditNote.organizationId,
    operationId: savedCreditNote._id,
    transactionId: savedCreditNote.creditNote,
    date: savedCreditNote.createdDate,
    accountId: paidThroughAccount.paidAccount?._id || undefined,
    action: "Credit Note",
    debitAmount: 0,
    creditAmount: savedCreditNote.totalAmount || 0,
    remark: savedCreditNote.note,
    createdDateTime:savedCreditNote.createdDateTime
  };

  let salesTotalDebit = 0;
  let salesTotalCredit = 0;

  if (Array.isArray(savedCreditNote.salesJournal)) {
    savedCreditNote.salesJournal.forEach((entry) => {

      salesTotalDebit += entry.debitAmount || 0;
      salesTotalCredit += entry.creditAmount || 0;

    });

    console.log("Total Debit Amount from saleJournal:", salesTotalDebit);
    console.log("Total Credit Amount from saleJournal:", salesTotalCredit);
  } else {
    console.error("SaleJournal is not an array or is undefined.");
  }
  


  console.log("cgst", cgst.debitAmount,  cgst.creditAmount);
  console.log("sgst", sgst.debitAmount,  sgst.creditAmount);
  console.log("igst", igst.debitAmount,  igst.creditAmount);
  console.log("vat", vat.debitAmount,  vat.creditAmount);

  console.log("customerCredit", customerCredit.debitAmount,  customerCredit.creditAmount);

  console.log("customerReceived", customerReceived.debitAmount,  customerReceived.creditAmount);
  console.log("paidThroughAccount", paidThroughAccounts.debitAmount,  paidThroughAccounts.creditAmount);

  const  debitAmount = customerCredit.debitAmount + salesTotalDebit + cgst.debitAmount  + sgst.debitAmount + igst.debitAmount +  vat.debitAmount + customerReceived.debitAmount + paidThroughAccounts.debitAmount ;
  const  creditAmount = customerCredit.creditAmount + salesTotalCredit + cgst.creditAmount  + sgst.creditAmount + igst.creditAmount +  vat.creditAmount + customerReceived.creditAmount + paidThroughAccounts.creditAmount ;

  console.log("Total Debit Amount: ", debitAmount );
  console.log("Total Credit Amount: ", creditAmount );



  //Sales
    savedCreditNote.salesJournal.forEach((entry) => {

      const data = {
        organizationId: savedCreditNote.organizationId,
        operationId: savedCreditNote._id,
        transactionId: savedCreditNote.creditNote,
        date: savedCreditNote.createdDateTime,
        accountId: entry.accountId || undefined,
        action: "Sales Return",
        debitAmount: entry.debitAmount || 0,
        creditAmount: entry.creditAmount || 0,
        remark: savedCreditNote.note,
        createdDateTime:savedCreditNote.createdDateTime
      };
      
      createTrialEntry( data )

    });

    
 



  //Tax
  if(savedCreditNote.cgst){
    createTrialEntry( cgst )
  }
  if(savedCreditNote.sgst){
    createTrialEntry( sgst )
  }
  if(savedCreditNote.igst){
    createTrialEntry( igst )
  }
  if(savedCreditNote.vat){
    createTrialEntry( vat )
  }

  //Credit
  createTrialEntry( customerCredit ) 
  
  //Paid
  if(savedCreditNote.paymentMode === 'Cash'){
    createTrialEntry( customerReceived )
    createTrialEntry( paidThroughAccounts )
  }
}



async function createTrialEntry( data ) {
  const newTrialEntry = new TrialBalance({
      organizationId:data.organizationId,
      operationId:data.operationId,
      transactionId: data.transactionId,
      date:data.date,
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
  accDataExists,
  itemDataExists,
  creditDataExist
};
exports.validation = {
  validateOrganizationTaxCurrency, 
  validateInputs,
  validPaymentMode,
  validInvoiceType,
  validCountries
};
exports.calculation = { 
  taxType,
  calculateCreditNote,
  updateSalesInvoiceWithCreditNote
};
exports.accounts = { 
  defaultAccounting,
  salesJournal,
  journal
};