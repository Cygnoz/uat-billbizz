const DebitNote = require('../../database/model/debitNote');
const Organization = require('../../database/model/organization');
const Bills = require('../../database/model/bills');
const Supplier = require('../../database/model/supplier');
const Item = require('../../database/model/item');
const Settings = require("../../database/model/settings");
const ItemTrack = require("../../database/model/itemTrack");
const Prefix = require("../../database/model/prefix");
const mongoose = require('mongoose');
const DefAcc  = require("../../database/model/defaultAccount");
const Account = require("../../database/model/account");
const TrialBalance = require("../../database/model/trialBalance");
const SupplierHistory = require("../../database/model/supplierHistory");

const { cleanData } = require("../../services/cleanData");
const { singleCustomDateTime, multiCustomDateTime } = require("../../services/timeConverter");

const { ObjectId } = require('mongodb');
const moment = require("moment-timezone");


// Fetch existing data
const dataExist = async ( organizationId, supplierId, billId ) => {
    const [organizationExists, supplierExist, billExist, settings, existingPrefix, defaultAccount, supplierAccount  ] = await Promise.all([
      Organization.findOne({ organizationId }, { organizationId: 1, organizationCountry: 1, state: 1, timeZoneExp: 1 }),
      Supplier.findOne({ organizationId , _id:supplierId}, { _id: 1, supplierDisplayName: 1, taxType: 1 }),
      Bills.findOne({ organizationId, _id:billId }, { _id: 1, billNumber: 1, billDate: 1, orderNumber: 1, supplierId: 1, sourceOfSupply: 1, destinationOfSupply: 1, items: 1 }),
      Settings.findOne({ organizationId }),
      Prefix.findOne({ organizationId }),
      DefAcc.findOne({ organizationId },{ inputCgst: 1, inputSgst: 1, inputIgst: 1 ,inputVat: 1 }),
      Account.findOne({ organizationId , accountId:supplierId },{ _id:1, accountName:1 })
    ]);    
  return { organizationExists, supplierExist, billExist, settings, existingPrefix, defaultAccount, supplierAccount };
};


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


// Fetch Acc existing data
const accDataExists = async ( organizationId, depositAccountId ) => {
  const [ depositAcc ] = await Promise.all([
    Account.findOne({ organizationId , _id: depositAccountId, accountHead: "Asset" }, { _id:1, accountName: 1 }),
  ]);
  return { depositAcc };
};


const debitDataExist = async ( organizationId, debitId ) => {    
  const [organizationExists, allDebitNote, debitNote, debitJournal ] = await Promise.all([
    Organization.findOne({ organizationId }, { timeZoneExp: 1, dateFormatExp: 1, dateSplit: 1, organizationCountry: 1 }),
    DebitNote.find({ organizationId },{ organizationId: 0,})
    .populate('supplierId', 'supplierDisplayName')
    .lean(),
    DebitNote.findOne({ organizationId , _id: debitId })
    .populate('items.itemId', 'itemName')
    .populate('supplierId', 'supplierDisplayName')
    .lean(),
    TrialBalance.find({ organizationId: organizationId, operationId : debitId })
    .populate('accountId', 'accountName')
    .lean(),
  ]);
  return { organizationExists, allDebitNote, debitNote, debitJournal };
};




// Add debit note
exports.addDebitNote = async (req, res) => {
  console.log("Add debit note:", req.body);

  try {
    const { organizationId, id: userId, userName } = req.user;
    // const { organizationId } = req.body;

    //Clean Data
    const cleanedData = cleanData(req.body);
    cleanedData.items = cleanedData.items?.map(data => cleanData(data)) || [];

    cleanedData.items = cleanedData.items
      ?.map(data => cleanData(data))
      .filter(item => item.itemId !== undefined && item.itemId !== '') || [];
      
    // cleanedData.depositAccountId = cleanedData.depositTo || undefined;

    const { supplierId, items, billId } = cleanedData;    
    const itemIds = items.map(item => item.itemId);
    
    // Check for duplicate itemIds
    const uniqueItemIds = new Set(itemIds);
    if (uniqueItemIds.size !== itemIds.length) {
      return res.status(400).json({ message: "Duplicate Item found" });
    }

    //Validate Supplier
    if (!mongoose.Types.ObjectId.isValid(supplierId) || supplierId.length !== 24) {
      return res.status(400).json({ message: `Invalid supplier ID: ${supplierId}` });
    }

    //Validate bill
    if (!mongoose.Types.ObjectId.isValid(billId) || billId.length !== 24) {
      return res.status(400).json({ message: `Invalid bill ID: ${billId}` });
    }

    // Validate ItemIds
    const invalidItemIds = itemIds.filter(itemId => !mongoose.Types.ObjectId.isValid(itemId) || itemId.length !== 24);
    if (invalidItemIds.length > 0) {
      return res.status(400).json({ message: `Invalid item IDs: ${invalidItemIds.join(', ')}` });
    }   

    const { organizationExists, supplierExist, billExist, existingPrefix, defaultAccount, supplierAccount } = await dataExist( organizationId, supplierId, billId );

    //Data Exist Validation
    if (!validateOrganizationTaxCurrency( organizationExists, supplierExist, billExist, existingPrefix, res )) return;
    
    const { itemTable } = await itemDataExists( organizationId, items );

    //Validate Inputs  
    if (!validateInputs( cleanedData, supplierExist, billExist, items, itemTable, organizationExists, res)) return;

    //Tax Type
    taxType(cleanedData, supplierExist );

    //Default Account
    const { defAcc, depositAccount, error } = await defaultAccounting( cleanedData, defaultAccount, organizationExists );
    if (error) { 
      res.status(400).json({ message: error }); 
      return false; 
    }    
    
    // Calculate Debit Note 
    if (!calculateDebitNote( cleanedData, res )) return;

    //Purchase Journal      
    if (!purchaseJournal( cleanedData, res )) return; 

    //Prefix
    await debitNotePrefix(cleanedData, existingPrefix );

    cleanedData.createdDateTime = moment.tz(cleanedData.supplierDebitDate, "YYYY-MM-DDTHH:mm:ss.SSS[Z]", organizationExists.timeZoneExp).toISOString();           

    const savedDebitNote = await createNewDebitNote(cleanedData, organizationId, userId, userName );

    // Add entry to Supplier History
    const supplierHistoryEntry = new SupplierHistory({
      organizationId,
      operationId: savedDebitNote._id,
      supplierId,
      title: "Debit Note Added",
      description: `Debit Note ${savedDebitNote.debitNote} of amount ${savedDebitNote.grandTotal} created by ${userName}`,  
      userId: userId,
      userName: userName,
    });

    await supplierHistoryEntry.save();

    //Journal
    await journal( savedDebitNote, defAcc, supplierAccount, depositAccount );

    //Item Track
    await itemTrack( savedDebitNote, itemTable );

    // Update Purchase Bill
    await updateBillWithDebitNote(billId, items);

    //Update Bill Balance
    await updateBillBalance( savedDebitNote, billId ); 

    // Calculate stock 
    await calculateStock(savedDebitNote);
      
    res.status(201).json({ message: "Debit Note created successfully",savedDebitNote });
    // console.log( "Debit Note created successfully:", savedDebitNote );
  } catch (error) {
    console.error("Error Creating Debit Note:", error);
    res.status(500).json({ message: "Internal server error." });
  }
}



// Get All Debit Note
exports.getAllDebitNote = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    const { organizationExists, allDebitNote } = await debitDataExist(organizationId, null);

    if (!organizationExists) return res.status(404).json({ message: "Organization not found" });
    
    if (!allDebitNote.length) return res.status(404).json({ message: "No Debit Note found" });

    const transformedData = allDebitNote.map(data => {
      return {
          ...data,
          supplierId: data.supplierId?._id,  
          supplierDisplayName: data.supplierId?.supplierDisplayName,  
      };});

    const formattedObjects = multiCustomDateTime(transformedData, organizationExists.dateFormatExp, organizationExists.timeZoneExp, organizationExists.dateSplit );    

    res.status(200).json(formattedObjects);
  } catch (error) {
    console.error("Error fetching Debit Note:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};


// Get One Debit Note
exports.getOneDebitNote = async (req, res) => {
try {
  const organizationId = req.user.organizationId;
  const debitId = req.params.debitId;

  const { organizationExists, debitNote } = await debitDataExist(organizationId, debitId);

  if (!organizationExists) return res.status(404).json({ message: "Organization not found" });

  if (!debitNote) return res.status(404).json({ message: "No Debit Note found" });

  const transformedData = {
    ...debitNote,
    supplierId: debitNote.supplierId?._id,  
    supplierDisplayName: debitNote.supplierId?.supplierDisplayName,
    items: debitNote.items.map(item => ({
      ...item,
      itemId: item.itemId?._id,
      itemName: item.itemId?.itemName,
    })),  
};

const formattedObjects = singleCustomDateTime(transformedData, organizationExists.dateFormatExp, organizationExists.timeZoneExp, organizationExists.dateSplit );    


  res.status(200).json(formattedObjects);
} catch (error) {
  console.error("Error fetching Debit Note:", error);
  res.status(500).json({ message: "Internal server error." });
}
};


// Get Debit Note Journal
exports.debitNoteJournal = async (req, res) => {
  try {
      const organizationId = req.user.organizationId;
      const { debitId } = req.params;

      const { debitJournal } = await debitDataExist( organizationId, debitId );      

      if (!debitJournal) {
          return res.status(404).json({
              message: "No Journal found for the Debit Note.",
          });
      }

      const transformedJournal = debitJournal.map(item => {
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


// Get last debit note prefix
exports.getLastDebitNotePrefix = async (req, res) => {
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
      const lastPrefix = series.debitNote + series.debitNoteNum;

      lastPrefix.organizationId = undefined;

      res.status(200).json(lastPrefix);
  } catch (error) {
      console.error("Error fetching accounts:", error);
      res.status(500).json({ message: "Internal server error." });
  }
};

// Debit Note Prefix
function debitNotePrefix( cleanData, existingPrefix ) {
  const activeSeries = existingPrefix.series.find(series => series.status === true);
  if (!activeSeries) {
      return res.status(404).json({ message: "No active series found for the organization." });
  }
  cleanData.debitNote = `${activeSeries.debitNote}${activeSeries.debitNoteNum}`;

  activeSeries.debitNoteNum += 1;

  existingPrefix.save() 
}










// Create New Debit Note
function createNewDebitNote( data, organizationId, userId, userName ) {
  const newDebitNote = new DebitNote({ ...data, organizationId, userId, userName });
  return newDebitNote.save();
}




// Validate Organization Tax Currency
function validateOrganizationTaxCurrency( organizationExists, supplierExist, billExist, existingPrefix, res ) {
  if (!organizationExists) {
    res.status(404).json({ message: "Organization not found" });
    return false;
  }
  if (!supplierExist) {
    res.status(404).json({ message: "Supplier not found." });
    return false;
  }
  if (!billExist) {
    res.status(404).json({ message: "Bill not found" });
    return false;
  }
  if (!existingPrefix) {
    res.status(404).json({ message: "Prefix not found" });
    return false;
  }
  return true;
}




// Tax Type
function taxType( cleanedData, supplierExist ) {

  if(supplierExist.taxType === 'GST' ){
    if(cleanedData.sourceOfSupply === cleanedData.destinationOfSupply){
      cleanedData.taxMode ='Intra';
    }
    else{
      cleanedData.taxMode ='Inter';
    }
  }
  if(supplierExist.taxType === 'VAT' ){
    cleanedData.taxMode ='VAT'; 
  }   
}




// Function to update purchase bill balance
const updateBillBalance = async (savedDebitNote, billId) => {
  try {
    const { grandTotal } = savedDebitNote;
    const bill = await Bills.findOne({ _id: billId });
    let newBalance = bill.balanceAmount - grandTotal; 
    if (newBalance < 0) {
      newBalance = 0;
    }
    console.log(`Updating purchase bill balance: ${newBalance}, Total Amount: ${grandTotal}, Old Balance: ${bill.balanceAmount}`);
    
    await Bills.findOneAndUpdate({ _id: billId }, { $set: { balanceAmount: newBalance } });
  } catch (error) {
    console.error("Error updating purchase bill balance:", error);
    throw new Error("Failed to update purchase bill balance.");
  }
};








//Default Account
async function defaultAccounting(data, defaultAccount, organizationExists) {
  // 1. Fetch required accounts
  const accounts = await accDataExists(
    organizationExists.organizationId, 
    data.depositAccountId
  );
  
  // 2. Check for missing required accounts
  const errorMessage = getMissingAccountsError(data, defaultAccount, accounts);
  if (errorMessage) {
    return { defAcc: null, error: errorMessage };
  }
  
  return { defAcc: defaultAccount, depositAccount: accounts.depositAcc, error: null };
}

function getMissingAccountsError(data, defaultAccount, accounts) {
  const accountChecks = [
    // Tax account checks
    { condition: data.cgst, account: defaultAccount.inputCgst, message: "CGST Account" },
    { condition: data.sgst, account: defaultAccount.inputSgst, message: "SGST Account" },
    { condition: data.igst, account: defaultAccount.inputIgst, message: "IGST Account" },
    { condition: data.vat, account: defaultAccount.inputVat, message: "VAT Account" },
    
    // Transaction account checks
    { condition: data.paidAmount, account: accounts.depositAcc, message: "Deposit Account" }
  ];

  const missingAccounts = accountChecks
    .filter(({ condition, account }) => condition && !account)
    .map(({ message }) => `${message} not found`);

  return missingAccounts.length ? missingAccounts.join(". ") : null;
}




















function calculateDebitNote(cleanedData, res) {
  const errors = [];

  let subTotal = 0;
  let totalTaxAmount = 0;
  // let itemTotalDiscount= 0;
  let totalItem = 0;
  // let transactionDiscountAmount = 0;
  let grandTotal = 0;

  // Utility function to round values to two decimal places
  const roundToTwoDecimals = (value) => Number(value.toFixed(2));  

  cleanedData.items.forEach(item => {

    let calculatedItemCgstAmount = 0;
    let calculatedItemSgstAmount = 0;
    let calculatedItemIgstAmount = 0;
    let calculatedItemVatAmount = 0;
    let calculatedItemTaxAmount = 0;
    let itemAmount = 0;
    let taxMode = cleanedData.taxMode;

    // Calculate item line discount 
    // const itemDiscAmt = calculateItemDiscount(item);

    // itemTotalDiscount +=  parseFloat(itemDiscAmt);
    totalItem +=  parseInt(item.itemQuantity);
    subTotal += parseFloat(item.itemQuantity * item.itemCostPrice);

    // itemAmount = (item.itemCostPrice * item.itemQuantity - itemDiscAmt);
    const withoutTaxAmount = (item.itemCostPrice * item.itemQuantity);

    // Handle tax calculation only for taxable items
    if (item.taxPreference === 'Taxable') {
      switch (taxMode) {
        
        case 'Intra':
          calculatedItemCgstAmount = roundToTwoDecimals((item.itemCgst / 100) * withoutTaxAmount);
          calculatedItemSgstAmount = roundToTwoDecimals((item.itemSgst / 100) * withoutTaxAmount);
        break;

        case 'Inter':
          calculatedItemIgstAmount = roundToTwoDecimals((item.itemIgst / 100) * withoutTaxAmount);
        break;
        
        case 'VAT':
          calculatedItemVatAmount = roundToTwoDecimals((item.itemVat / 100) * withoutTaxAmount);
        break;

      }

      calculatedItemTaxAmount =  calculatedItemCgstAmount + calculatedItemSgstAmount + calculatedItemIgstAmount + calculatedItemVatAmount;
      
      // Check tax amounts
      checkAmount(calculatedItemCgstAmount, item.itemCgstAmount, item.itemName, 'CGST',errors);
      checkAmount(calculatedItemSgstAmount, item.itemSgstAmount, item.itemName, 'SGST',errors);
      checkAmount(calculatedItemIgstAmount, item.itemIgstAmount, item.itemName, 'IGST',errors);
      checkAmount(calculatedItemVatAmount, item.itemVatAmount, item.itemName, 'VAT',errors);
      checkAmount(calculatedItemTaxAmount, item.itemTax, item.itemName, 'Item tax',errors);

      totalTaxAmount += calculatedItemTaxAmount;     

    } else {
      console.log(`Skipping Tax for Non-Taxable item: ${item.itemName}`);
      // console.log(`Item: ${item.itemName}, Calculated Discount: ${itemDiscAmt}`);
    }

    itemAmount = (withoutTaxAmount + calculatedItemTaxAmount);

    checkAmount(itemAmount, item.itemAmount, item.itemName, 'Item Total',errors);

    console.log(`${item.itemName} Item Total: ${itemAmount} , Provided ${item.itemAmount}`);
    console.log(`${item.itemName} Total Tax: ${calculatedItemTaxAmount} , Provided ${item.itemTax || 0 }`);
    console.log("");
  });

  // const total = ((parseFloat(subTotal) + parseFloat(totalTaxAmount)) - itemTotalDiscount);
  const total = ((parseFloat(subTotal) + parseFloat(totalTaxAmount)));

  console.log(`SubTotal: ${subTotal} , Provided ${cleanedData.subTotal}`);

  // Transaction Discount
  // let transDisAmt = calculateTransactionDiscount(cleanedData, total, transactionDiscountAmount); 

  // grandTotal amount calculation with including transactionDiscount
  // grandTotal = total - transDisAmt; 
  grandTotal = total; 

  // Round the totals for comparison
  const roundedSubTotal = roundToTwoDecimals(subTotal); //23.24 
  const roundedTotalTaxAmount = roundToTwoDecimals(totalTaxAmount);
  const roundedGrandTotalAmount = roundToTwoDecimals(grandTotal);
  // const roundedTotalItemDiscount = roundToTwoDecimals(itemTotalDiscount);

  console.log(`Final Sub Total: ${roundedSubTotal} , Provided ${cleanedData.subTotal}` );
  console.log(`Final Total Tax Amount: ${roundedTotalTaxAmount} , Provided ${cleanedData.totalTaxAmount}` );
  console.log(`Final Total Amount: ${roundedGrandTotalAmount} , Provided ${cleanedData.grandTotal}` );
  // console.log(`Final Total Item Discount Amount: ${roundedTotalItemDiscount} , Provided ${cleanedData.itemTotalDiscount}` );

  validateAmount(roundedSubTotal, cleanedData.subTotal, 'SubTotal', errors);
  validateAmount(roundedTotalTaxAmount, cleanedData.totalTaxAmount, 'Total Tax Amount', errors);
  validateAmount(roundedGrandTotalAmount, cleanedData.grandTotal, 'Grand Total', errors);
  // validateAmount(roundedTotalItemDiscount, cleanedData.itemTotalDiscount, 'Total Item Discount Amount', errors);
  validateAmount(totalItem, cleanedData.totalItem, 'Total Item count', errors);

  if (errors.length > 0) {
    res.status(400).json({ message: errors.join(", ") });
    return false;
  }

  return true;
}


function purchaseJournal(cleanedData, res) {
  const errors = [];
  

  // Utility function to round values to two decimal places
  const roundToTwoDecimals = (value) => Number(value.toFixed(2));

  // Group items by salesAccountId and calculate debit amounts
  const accountEntries = {};


  cleanedData.items.forEach(item => {
          
          const accountId = item.purchaseAccountId;
          
          if (!accountId) {

            errors.push({
              message: `Purchase Account not found for item ${item.itemName}`,
            });
            return; 
          }
    
          const creditAmount = roundToTwoDecimals(item.itemCostPrice * item.itemQuantity);

          if (!accountEntries[accountId]) {
            accountEntries[accountId] = { accountId, creditAmount: 0 };
          }
          // Accumulate the debit amount
          accountEntries[accountId].creditAmount += creditAmount;
  });

  // Push the grouped entries into cleanedData.journal
  cleanedData.purchaseJournal = Object.values(accountEntries);
  console.log("purchaseJournal:", cleanedData.purchaseJournal);  
  
  // Handle response or further processing
  if (errors.length > 0) {
    res.status(400).json({ success: false, message:"Purchase journal error", errors });
    return false;
  }
  return true;
}




// // Calculate item discount
// function calculateItemDiscount(item) {
//   return item.itemDiscountType === 'currency'
//     ? item.itemDiscount || 0
//     : (item.itemCostPrice * item.itemQuantity * (item.itemDiscount || 0)) / 100;    //if percentage
// }


// //TransactionDiscount
// function calculateTransactionDiscount(cleanedData, total, transactionDiscountAmount) {
//   transactionDiscountAmount = cleanedData.transactionDiscount || 0;

//   return cleanedData.transactionDiscountType === 'currency'
//     ? transactionDiscountAmount
//     : (total * cleanedData.transactionDiscount) / 100;    //if percentage
// }


//Mismatch Check
function checkAmount(calculatedAmount, providedAmount, itemName, taxMode, errors) {
  const roundToTwoDecimals = (value) => Number(value.toFixed(2)); // Round to two decimal places
  const roundedAmount = roundToTwoDecimals(calculatedAmount);
  console.log(`Item: ${itemName}, Calculated ${taxMode}: ${roundedAmount}, Provided data: ${providedAmount}`);

  if (Math.abs(roundedAmount - providedAmount) > 0.01) {
    const errorMessage = `Mismatch in ${taxMode} for item ${itemName}: Calculated ${calculatedAmount}, Provided ${providedAmount}`;
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
function validateInputs( data, supplierExist, billExist, items, itemExists, organizationExists, res) {
  const validationErrors = validateDebitNoteData(data, supplierExist, billExist, items, itemExists, organizationExists);  

  if (validationErrors.length > 0) {
    res.status(400).json({ message: validationErrors.join(", ") });
    return false;
  }
  return true;
}

//Validate Data
function validateDebitNoteData( data, supplierExist, billExist, items, itemTable, organizationExists ) {
  const errors = [];

  //Basic Info
  validateReqFields( data, supplierExist, errors );
  validateItemTable(items, itemTable, errors);
  validateBillData(data, items, billExist, errors);
  // validateTransactionDiscountType(data.transactionDiscountType, errors);
  // console.log("billExist Data:", billExist.billNumber, billExist.billDate, billExist.orderNumber)

  //OtherDetails
  validateIntegerFields(['totalItem'], data, errors);
  // validateFloatFields(['transactionDiscountAmount', 'subTotal','cgst','sgst','igst','vat','totalTaxAmount','grandTotal'], data, errors);
  validateFloatFields(['subTotal','cgst','sgst','igst','vat','totalTaxAmount','grandTotal'], data, errors);
  //validateAlphabetsFields(['department', 'designation'], data, errors);

  //Tax Details
  //validateTaxType(data.taxType, validTaxTypes, errors);
  validateSourceOfSupply(data.sourceOfSupply, organizationExists, errors);
  validateDestinationOfSupply(data.destinationOfSupply, organizationExists, errors);
  validateBillType(data.billType, errors);
  validatePaymentMode(data.paymentMode, errors);
  //validateGSTorVAT(data, errors);

  //Currency
  //validateCurrency(data.currency, validCurrencies, errors);

  //Address
  //validateBillingAddress(data, errors);
  //validateShippingAddress(data, errors);  
  return errors;
}



// Field validation utility
function validateField(condition, errorMsg, errors) {
  if (condition) errors.push(errorMsg);
}


//Valid Req Fields
function validateReqFields( data, supplierExist, errors ) {
validateField( typeof data.supplierId === 'undefined', "Please select a Supplier", errors  );
validateField( typeof data.supplierDebitDate === 'undefined', "Please select Supplier Debit Date", errors  );



validateField( supplierExist.taxType == 'GST' && typeof data.sourceOfSupply === 'undefined', "Source of supply required", errors  );
validateField( supplierExist.taxType == 'GST' && typeof data.destinationOfSupply === 'undefined', "Destination of supply required", errors  );

validateField( typeof data.items === 'undefined', "Select an item", errors  );
validateField( Array.isArray(data.items) && data.items.length === 0, "Select an item", errors );

// validateField( typeof data.billNumber === 'undefined', "Select an bill number", errors  );
validateField( typeof data.billType === 'undefined', "Select an bill type", errors  );
validateField( typeof data.paymentMode === 'undefined', "Select payment mode", errors  );

validateField( typeof data.supplierDebitDate === 'undefined', "Select supplier debit date", errors  );
validateField( typeof data.paymentMode === 'undefined', "Select payment mode", errors  );

validateField( typeof data.grandTotal === 'undefined', "Enter the amount", errors  );
validateField( data.paymentMode === 'Cash' && typeof data.depositAccountId === 'undefined', "Select  deposit account", errors  );  
}


// Function to Validate Item Table 
function validateItemTable(items, itemTable, errors) {
// Check for item count mismatch
validateField( items.length !== itemTable.length, "Mismatch in item count between request and database.", errors  );

// Iterate through each item to validate individual fields
items.forEach((item) => {
  const fetchedItem = itemTable.find(it => it._id.toString() === item.itemId);

  // Check if item exists in the item table
  validateField( !fetchedItem, `Item with ID ${item.itemId} was not found.`, errors );
  if (!fetchedItem) return; 

  // Validate item name
  // validateField( item.itemName !== fetchedItem.itemName, `Item Name Mismatch : ${item.itemName}`, errors );

  // Validate cost price
  // validateField( item.itemCostPrice !== fetchedItem.costPrice, `Cost price Mismatch for ${item.itemName}:  ${item.itemCostPrice}`, errors );

  // Validate CGST
  validateField( item.itemCgst !== fetchedItem.cgst, `CGST Mismatch for ${item.itemName}: ${item.itemCgst}`, errors );

  // Validate SGST
  validateField( item.itemSgst !== fetchedItem.sgst, `SGST Mismatch for ${item.itemName}: ${item.itemSgst}`, errors );

  // Validate IGST
  validateField( item.itemIgst !== fetchedItem.igst, `IGST Mismatch for ${item.itemName}: ${item.itemIgst}`, errors );

  // Validate tax preference
  validateField( item.taxPreference !== fetchedItem.taxPreference, `Tax Preference mismatch for ${item.itemName}: ${item.taxPreference}`, errors );

  // Validate discount type
  // validateItemDiscountType(item.itemDiscountType, errors);

  // Validate integer fields
  validateIntegerFields(['itemQuantity'], item, errors);

  // Validate Stock Count 
  // validateField( item.itemQuantity > fetchedItem.currentStock, `Insufficient Stock for ${item.itemName}: Requested quantity ${item.itemQuantity}, Available stock ${fetchedItem.currentStock}`, errors );

  // Validate float fields
  validateFloatFields(['itemCostPrice', 'itemTotalTax', 'itemAmount'], item, errors);
});
}


// validate bill data
function validateBillData(data, items, billExist, errors) {  

   // Initialize `billExist.items` to an empty array if undefined
   billExist.items = Array.isArray(billExist.items) ? billExist.items : [];

  // Validate basic fields
  validateField( billExist.billDate !== data.billDate, `Bill Date mismatch for ${billExist.billDate}`, errors  );
  validateField( billExist.orderNumber !== data.orderNumber, `Order Number mismatch for ${billExist.orderNumber}`, errors  );

  // Validate only the items included in the debit note
  items.forEach(dNItem => {
    const billItem = billExist.items.find(dataItem => dataItem.itemId.toString() === dNItem.itemId.toString());

    if (!billItem) {
      errors.push(`Item ID ${dNItem.itemId} not found in provided bills.`);
    } else {

      // validateField(dNItem.itemName !== billItem.itemName, 
      // `Item Name mismatch for ${billItem.itemId}: Expected ${billItem.itemName}, got ${dNItem.itemName}`, errors);

      validateField(dNItem.itemCostPrice !== billItem.itemCostPrice, 
        `Item Cost Price mismatch for ${billItem.itemId}: Expected ${billItem.itemCostPrice}, got ${dNItem.itemCostPrice}`, errors);

      validateField(dNItem.itemCgst !== billItem.itemCgst, 
        `Item CGST mismatch for ${billItem.itemId}: Expected ${billItem.itemCgst}, got ${dNItem.itemCgst}`, errors);
      
      validateField(dNItem.itemSgst !== billItem.itemSgst, 
        `Item SGST mismatch for ${billItem.itemId}: Expected ${billItem.itemSgst}, got ${dNItem.itemSgst}`, errors);
      
      validateField(dNItem.itemIgst !== billItem.itemIgst, 
        `Item IGST mismatch for ${billItem.itemId}: Expected ${billItem.itemIgst}, got ${dNItem.itemIgst}`, errors);
      
      if (billItem.returnQuantity === 0) {
        validateField(dNItem.stock !== billItem.itemQuantity, 
          `Stock mismatch for ${billItem.itemId}: Expected ${billItem.itemQuantity}, got ${dNItem.stock}`, errors);
      } else {
        const expectedReturnQuantity = billItem.itemQuantity - billItem.returnQuantity;
        validateField(dNItem.stock !== expectedReturnQuantity, 
          `Stock mismatch for ${billItem.itemId}: Expected ${expectedReturnQuantity}, got ${dNItem.stock}`, errors);
      }
      
      validateField(dNItem.itemQuantity > billItem.itemQuantity, 
        `Provided quantity (${dNItem.itemQuantity}) cannot exceed bill items quantity (${billItem.itemQuantity}).`, errors);
      
      validateField(dNItem.itemQuantity <= 0, 
        `Quantity must be greater than 0 for item ${dNItem.itemId}.`, errors);
      
      validateField(dNItem.itemQuantity > dNItem.stock, 
        `Provided quantity (${dNItem.itemQuantity}) cannot exceed stock available (${dNItem.stock}) for item ${dNItem.itemId}.`, errors);
    }
  });
}



// Validate source Of Supply
function validateSourceOfSupply(sourceOfSupply, organization, errors) {
  validateField(
    sourceOfSupply && !validCountries[organization.organizationCountry]?.includes(sourceOfSupply),
    "Invalid Source of Supply: " + sourceOfSupply, errors );
}

// Validate destination Of Supply
function validateDestinationOfSupply(destinationOfSupply, organization, errors) {
  validateField(
    destinationOfSupply && !validCountries[organization.organizationCountry]?.includes(destinationOfSupply),
    "Invalid Destination of Supply: " + destinationOfSupply, errors );
}

// //Validate Discount Transaction Type
// function validateTransactionDiscountType(transactionDiscountType, errors) {
// validateField(transactionDiscountType && !validTransactionDiscountType.includes(transactionDiscountType),
//   "Invalid Transaction Discount: " + transactionDiscountType, errors);
// } 

// //Validate Item Discount Transaction Type
// function validateItemDiscountType(itemDiscountType, errors) {
//   validateField(itemDiscountType && !validItemDiscountType.includes(itemDiscountType),
//     "Invalid Item Discount: " + itemDiscountType, errors);
// }

// Validate Bill Type
function validateBillType(billType, errors) {
  validateField(
    billType && !validBillType.includes(billType),
    "Invalid Bill Type: " + billType, errors );
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
async function itemTrack(savedDebitNote, itemTable) {
  const { items } = savedDebitNote;

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
      organizationId: savedDebitNote.organizationId,
      operationId: savedDebitNote._id,
      transactionId: savedDebitNote.debitNote,
      action: "Debit Note",
      itemId: matchingItem._id,
      sellingPrice: matchingItem.itemSellingPrice || 0,
      costPrice: matchingItem.itemCostPrice || 0, 
      creditQuantity: item.itemQuantity,
      createdDateTime: savedDebitNote.createdDateTime  
    });
    await newTrialEntry.save();
  }
}




// Function to update bills with returnItem
const updateBillWithDebitNote = async (billId, items) => {
  try {
    for (const item of items) {
      await Bills.findOneAndUpdate(
        { _id: billId, 'items.itemId': item.itemId },
        {
          $inc: { 'items.$.returnQuantity': item.itemQuantity } // Increment quantity if item exists
        }
      );

      // If the itemId was not found and updated, add a new entry
      await Bills.findOneAndUpdate(
        { _id: billId, 'items.itemId': { $ne: item.itemId } },
        {
          $push: {
            items: {
              returnQuantity: item.itemQuantity
            }
          }
        }
      );
    }
  } catch (error) {
    console.error("Error updating Bills:", error);
    throw new Error("Failed to update Bills with Debit Note details.");
  }
};



// Helper function to calculate stock
const calculateStock = async (debitNote) => {
  try {
    const { billId, items } = debitNote;

    // Fetch corresponding bills
    const bills = await Bills.findById(billId);
    const stockData = [];

    if (bills) {
      items.forEach((debitItem) => {
        const billItem = bills.items.find(
          (item) => item.itemId.toString() === debitItem.itemId.toString()
        );

        const stock = billItem
          ? Math.max(billItem.quantity - billItem.returnQuantity, 0)
          : 0;

        stockData.push({ itemId: debitItem.itemId, stock });
      });
    }

    return stockData; // Return computed values without modifying current CreditNote 
  } catch (error) {
    console.error("Error in calculateStock:", error);
    throw new Error("Failed to calculate stock for Debit Note.");
  }
};






// Utility functions
// const validItemDiscountType = ["percentage", "currency"];
// const validTransactionDiscountType = ["percentage", "currency"];
const validPaymentMode = [ "Cash", "Credit" ]
const validBillType = [
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




























async function journal( savedDebitNote, defAcc, supplierAccount, depositAccount ) {
    
  const cgst = {
    organizationId: savedDebitNote.organizationId,
    operationId: savedDebitNote._id,
    transactionId: savedDebitNote.debitNote,
    date: savedDebitNote.createdDate,
    accountId: defAcc.inputCgst || undefined,
    action: "Purchase Return",
    debitAmount:  0,
    creditAmount: savedDebitNote.cgst || 0,
    remark: savedDebitNote.note,
    createdDateTime:savedDebitNote.createdDateTime
  };
  const sgst = {
    organizationId: savedDebitNote.organizationId,
    operationId: savedDebitNote._id,
    transactionId: savedDebitNote.debitNote,
    date: savedDebitNote.createdDate,
    accountId: defAcc.inputSgst || undefined,
    action: "Purchase Return",
    debitAmount: 0,
    creditAmount: savedDebitNote.sgst || 0,
    remark: savedDebitNote.note,
    createdDateTime:savedDebitNote.createdDateTime
  };
  const igst = {
    organizationId: savedDebitNote.organizationId,
    operationId: savedDebitNote._id,
    transactionId: savedDebitNote.debitNote,
    date: savedDebitNote.createdDate,
    accountId: defAcc.inputIgst || undefined,
    action: "Purchase Return",
    debitAmount: 0,
    creditAmount: savedDebitNote.igst || 0,
    remark: savedDebitNote.note,
    createdDateTime:savedDebitNote.createdDateTime
  };
  const vat = {
    organizationId: savedDebitNote.organizationId,
    operationId: savedDebitNote._id,
    transactionId: savedDebitNote.debitNote,
    date: savedDebitNote.createdDate,
    accountId: defAcc.inputVat || undefined,
    action: "Purchase Return",
    debitAmount: 0,
    creditAmount: savedDebitNote.vat || 0,
    remark: savedDebitNote.note,
    createdDateTime:savedDebitNote.createdDateTime
  };
  const supplierCredit = {
    organizationId: savedDebitNote.organizationId,
    operationId: savedDebitNote._id,
    transactionId: savedDebitNote.debitNote,
    date: savedDebitNote.createdDate,
    accountId: supplierAccount._id || undefined,
    action: "Purchase Return",
    debitAmount: savedDebitNote.grandTotal || 0,
    creditAmount:  0,
    remark: savedDebitNote.note,
    createdDateTime:savedDebitNote.createdDateTime
  };
  const supplierReceived = {
    organizationId: savedDebitNote.organizationId,
    operationId: savedDebitNote._id,
    transactionId: savedDebitNote.debitNote,
    date: savedDebitNote.createdDate,
    accountId: supplierAccount._id || undefined,
    action: "Debit Note",
    debitAmount: 0,
    creditAmount: savedDebitNote.grandTotal || 0,
    remark: savedDebitNote.note,
    createdDateTime:savedDebitNote.createdDateTime
  };
  const depositAccounts = {
    organizationId: savedDebitNote.organizationId,
    operationId: savedDebitNote._id,
    transactionId: savedDebitNote.debitNote,
    date: savedDebitNote.createdDate,
    accountId: depositAccount?._id || undefined,
    action: "Debit Note",
    debitAmount: savedDebitNote.grandTotal || 0,
    creditAmount: 0,
    remark: savedDebitNote.note,
    createdDateTime:savedDebitNote.createdDateTime
  };

  let purchaseTotalDebit = 0;
  let purchaseTotalCredit = 0;

  if (Array.isArray(savedDebitNote.purchaseJournal)) {
    savedDebitNote.purchaseJournal.forEach((entry) => {

      console.log( "Account Log",entry.accountId, entry.debitAmount, entry.creditAmount );      

      purchaseTotalDebit += entry.debitAmount || 0;
      purchaseTotalCredit += entry.creditAmount || 0;

    });

    console.log("Total Debit Amount from savedDebitNote:", purchaseTotalDebit);
    console.log("Total Credit Amount from savedDebitNote:", purchaseTotalCredit);
  } else {
    console.error("SavedDebitNote is not an array or is undefined.");
  }

  console.log("cgst", cgst.debitAmount,  cgst.creditAmount);
  console.log("sgst", sgst.debitAmount,  sgst.creditAmount);
  console.log("igst", igst.debitAmount,  igst.creditAmount);
  console.log("vat", vat.debitAmount,  vat.creditAmount);

  console.log("supplierCredit", supplierCredit.debitAmount,  supplierCredit.creditAmount);
  console.log("supplierReceived", supplierReceived.debitAmount,  supplierReceived.creditAmount);

  
  console.log("depositAccounts", depositAccounts.debitAmount,  depositAccounts.creditAmount);


  // const  debitAmount = cgst.debitAmount  + sgst.debitAmount + igst.debitAmount +  vat.debitAmount + purchase.debitAmount + supplier.debitAmount + discount.debitAmount + otherExpense.debitAmount + freight.debitAmount + roundOff.debitAmount + supplierPaid.debitAmount + paidAccount.debitAmount ;
  // const  creditAmount = cgst.creditAmount  + sgst.creditAmount + igst.creditAmount +  vat.creditAmount + purchase.creditAmount + supplier.creditAmount + discount.creditAmount + otherExpense.creditAmount + freight.creditAmount + roundOff.creditAmount + supplierPaid.creditAmount + paidAccount.creditAmount ;
  const debitAmount = 
  cgst.debitAmount  + 
  sgst.debitAmount  + 
  igst.debitAmount  + 
  vat.debitAmount  + 
  supplierCredit.debitAmount  + 
  depositAccounts.debitAmount  + 
  purchaseTotalDebit ;


const creditAmount = 
  cgst.creditAmount  + 
  sgst.creditAmount  + 
  igst.creditAmount  + 
  vat.creditAmount  + 
  purchaseTotalCredit  + 
  supplierReceived.creditAmount  + 
  depositAccounts.creditAmount ;

  console.log("Total Debit Amount: ", debitAmount );
  console.log("Total Credit Amount: ", creditAmount );

  // console.log( discount, sale, cgst, sgst, igst, vat, customer, otherExpense, freight, roundOff );


  //Purchase
  savedDebitNote.purchaseJournal.forEach((entry) => {

    const data = {
      organizationId: savedDebitNote.organizationId,
      operationId: savedDebitNote._id,
      transactionId: savedDebitNote.debitNote,
      date: savedDebitNote.createdDate,
      accountId: entry.accountId || undefined,
      action: "Purchase Return",
      debitAmount: 0,
      creditAmount: entry.creditAmount || 0,
      remark: savedDebitNote.note,
      createdDateTime:savedDebitNote.createdDateTime
    };
    
    createTrialEntry( data )

  });


  // createTrialEntry( purchase )

  //Tax
  if(savedDebitNote.cgst){
    createTrialEntry( cgst )
  }
  if(savedDebitNote.sgst){
    createTrialEntry( sgst )
  }
  if(savedDebitNote.igst){
    createTrialEntry( igst )
  }
  if(savedDebitNote.vat){
    createTrialEntry( vat )
  }
 
  //Credit
  createTrialEntry( supplierCredit )
  
  //Paid
  if(savedDebitNote.paymentMode ==='Cash'){
    createTrialEntry( supplierReceived )
    createTrialEntry( depositAccounts )
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
      debitAmount: data.debitAmount || 0,
      creditAmount: data.creditAmount || 0,
      remark: data.remark,
      createdDateTime:data.createdDateTime
});

const aa = await newTrialEntry.save();
console.log("newTrialEntry",aa);

}









exports.dataExist = {
  dataExist,
  accDataExists,
  itemDataExists,
  debitDataExist
};
exports.validation = {
  validateOrganizationTaxCurrency, 
  validateInputs,
  validPaymentMode,
  validBillType,
  validCountries
};
exports.calculation = { 
  taxType,
  calculateDebitNote,
  updateBillWithDebitNote
};
exports.accounts = { 
  defaultAccounting,
  purchaseJournal,
  journal
};