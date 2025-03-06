const Bills = require('../../database/model/bills');
const PurchaseOrder = require('../../database/model/purchaseOrder');
const Organization = require('../../database/model/organization');
const Supplier = require('../../database/model/supplier');
const Item = require('../../database/model/item');
const Settings = require("../../database/model/settings");
const ItemTrack = require("../../database/model/itemTrack");
const mongoose = require('mongoose');
const Prefix = require("../../database/model/prefix");
const DefAcc  = require("../../database/model/defaultAccount");
const TrialBalance = require("../../database/model/trialBalance");
const Account = require("../../database/model/account");
const SupplierHistory = require("../../database/model/supplierHistory");

const { cleanData } = require("../../services/cleanData");
const { singleCustomDateTime, multiCustomDateTime } = require("../../services/timeConverter");

const { ObjectId } = require('mongodb');
const moment = require("moment-timezone");


// Fetch existing data
const dataExist = async ( organizationId, supplierId ) => {
    const [organizationExists, supplierExist, existingPrefix, settings, defaultAccount , supplierAccount] = await Promise.all([
      Organization.findOne({ organizationId }, { organizationId: 1, organizationCountry: 1, state: 1, timeZoneExp: 1 }),
      Supplier.findOne({ organizationId , _id:supplierId}, { _id: 1, supplierDisplayName: 1, taxType: 1 }),
      Prefix.findOne({ organizationId }),
      Settings.findOne({ organizationId }),
      DefAcc.findOne({ organizationId },{ purchaseAccount: 1, purchaseDiscountAccount: 1, inputCgst: 1, inputSgst: 1, inputIgst: 1 ,inputVat: 1 }),
      Account.findOne({ organizationId , accountId:supplierId },{ _id:1, accountName:1 })
    ]);    
  return { organizationExists, supplierExist, existingPrefix, settings, defaultAccount, supplierAccount };
};


//Fetch Item Data
const itemDataExists = async (organizationId,items) => {
  // Retrieve items with specified fields
  const itemIds = items.map(item => new mongoose.Types.ObjectId(item.itemId));

  const [newItems] = await Promise.all([
    Item.find( { organizationId, _id: { $in: itemIds } },
    { _id: 1, itemName: 1, taxPreference: 1, sellingPrice: 1, costPrice: 1, taxRate: 1, cgst: 1, sgst: 1, igst: 1, vat: 1 }
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
const accDataExists = async ( organizationId, otherExpenseAccountId, freightAccountId, paidAccountId ) => {
  const [ otherExpenseAcc, freightAcc, paidAcc ] = await Promise.all([
    Account.findOne({ organizationId , _id: otherExpenseAccountId, accountHead: "Expenses" }, { _id:1, accountName: 1 }),
    Account.findOne({ organizationId , _id: freightAccountId, accountHead: "Expenses" }, { _id:1, accountName: 1 }),
    Account.findOne({ organizationId , _id: paidAccountId, accountHead: "Asset" }, { _id:1, accountName: 1 }),

  ]);
  return { otherExpenseAcc, freightAcc, paidAcc };
};


const billsDataExist = async ( organizationId, billId ) => {    
    const [organizationExists, allBills, bill, billJournal ] = await Promise.all([
      Organization.findOne({ organizationId },{ timeZoneExp: 1, dateFormatExp: 1, dateSplit: 1, organizationCountry: 1 }).lean(),
      Bills.find({ organizationId })
      .populate('items.itemId', 'itemName') 
      .populate('supplierId', 'supplierDisplayName')    
      .lean(),
      Bills.findOne({ organizationId , _id: billId })
      .populate('items.itemId', 'itemName itemImage') 
      .populate('supplierId', 'supplierDisplayName')    
      .lean(),      
      TrialBalance.find({ organizationId: organizationId, operationId : billId })
      .populate('accountId', 'accountName')    
      .lean(),
    ]);
    return { organizationExists, allBills, bill, billJournal };
  };



// Add Bills
exports.addBills = async (req, res) => {
    console.log("Add bills:", req.body);  
    try {
      const { organizationId, id: userId, userName } = req.user;
  
      //Clean Data
      const cleanedData = cleanData(req.body);
      cleanedData.items = cleanedData.items?.map(data => cleanData(data)) || [];

      cleanedData.items = cleanedData.items
      ?.map(data => cleanData(data))
      .filter(item => item.itemId !== undefined && item.itemId !== '') || []; 
      
      const { items, purchaseOrderId, supplierId, otherExpenseAccountId, freightAccountId, paidAccountId } = cleanedData;      
      const itemIds = items.map(item => item.itemId);      
      
      // Check for duplicate itemIds
      const uniqueItemIds = new Set(itemIds);
      if (uniqueItemIds.size !== itemIds.length) {
        return res.status(400).json({ message: "Duplicate Item found" });
      }
      
      if ( typeof itemIds[0] === 'undefined' ) {
        return res.status(400).json({ message: "Select an Item" });
      }
  
      //Validate Supplier
      if (!mongoose.Types.ObjectId.isValid(supplierId) || supplierId.length !== 24) {
        return res.status(400).json({ message: `Select a supplier` });
      }

      if ((!mongoose.Types.ObjectId.isValid(otherExpenseAccountId) || otherExpenseAccountId.length !== 24) && cleanedData.otherExpenseAmount !== undefined ) {
        return res.status(400).json({ message: `Select other expense account` });
      }

      if ((!mongoose.Types.ObjectId.isValid(freightAccountId) || freightAccountId.length !== 24) && cleanedData.freightAmount !== undefined ) {
        return res.status(400).json({ message: `Select freight account` });
      }

      if ((!mongoose.Types.ObjectId.isValid(paidAccountId) || paidAccountId.length !== 24) && cleanedData.paidAmount !== undefined ) {
        return res.status(400).json({ message: `Select paid through account` });
      }     
      
      // Validate ItemIds
      const invalidItemIds = itemIds.filter(itemId => !mongoose.Types.ObjectId.isValid(itemId) || itemId.length !== 24);
      if (invalidItemIds.length > 0) {
        return res.status(400).json({ message: `Invalid item IDs: ${invalidItemIds.join(', ')}` });
      }   
      
      const { organizationExists, supplierExist, existingPrefix, defaultAccount, supplierAccount } = await dataExist( organizationId, supplierId );
      
      const { itemTable } = await itemDataExists( organizationId, items );
      
      //Data Exist Validation
      if (!validateOrganizationSupplierOrder( organizationExists, supplierExist, existingPrefix, defaultAccount, res )) return;
      
      //Validate Inputs  
      if (!validateInputs( cleanedData, supplierExist, items, itemTable, organizationExists, defaultAccount, res)) return;
      
      //Check Bill Exist
      // if (await checkExistingBill(cleanedData.billNumber, organizationId, res)) return;
  
      //Tax Type
      taxType(cleanedData, supplierExist );

      //Default Account
      const { defAcc, error } = await defaultAccounting( cleanedData, defaultAccount, organizationExists );
      if (error) { 
        res.status(400).json({ message: error }); 
        return false; 
      }

      // Calculate Sales 
      if (!calculateBills( cleanedData, itemTable, res )) return;
      
      //Purchase Journal      
      if (!purchaseJournal( cleanedData, res )) return; 

      //Prefix
      await billsPrefix(cleanedData, existingPrefix );

      cleanedData.createdDateTime = moment.tz(cleanedData.billDate, "YYYY-MM-DDTHH:mm:ss.SSS[Z]", organizationExists.timeZoneExp).toISOString();           
  
      const savedBills = await createNewBills(cleanedData, organizationId, userId, userName );

      // Add entry to Supplier History
      const supplierHistoryEntry = new SupplierHistory({
        organizationId,
        operationId: savedBills._id,
        supplierId,
        title: "Purchase Bill Added",
        description: `Purchase Bill ${savedBills.billNumber} of amount ${savedBills.grandTotal} created by ${userName}`,  
        userId: userId,
        userName: userName,
      });
  
      await supplierHistoryEntry.save();
  
      //Journal      
      await journal( savedBills, defAcc, supplierAccount );

      //Item Track
      await itemTrack( savedBills, itemTable );

      // Delete the associated purchase order if purchaseOrderId is provided
      if (purchaseOrderId) {
        await deletePurchaseOrder(purchaseOrderId, organizationId, res);
      }
 
      res.status(201).json({ message: "Bills created successfully", savedBills });
      console.log( "Bills created successfully:", savedBills );
    } catch (error) {
      console.error("Error Creating Bills:", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }
  
  
  
  // Get All Bills
  exports.getAllBills = async (req, res) => {
    try {
      const organizationId = req.user.organizationId;
  
      const { organizationExists, allBills } = await billsDataExist( organizationId, null );
  
      if (!organizationExists) {
        return res.status(404).json({ message: "Organization not found" });
      }

      if (!allBills) {
        return res.status(404).json({ message: "No Invoice found" });
      }

      const transformedBill = allBills.map(data => {
        return {
            ...data,
            supplierId: data.supplierId?._id,  
            supplierDisplayName: data.supplierId?.supplierDisplayName,
            items: data.items.map(item => ({
              ...item,
              itemId: item.itemId?._id,
              itemName: item.itemId?.itemName,
            })),  
        };
      });
  

        // Get current date for comparison
        const currentDate = new Date();

      

        // Map through purchase bills and update paidStatus if needed
        for (const bill of allBills) {
        const { balanceAmount, dueDate, paidStatus: currentStatus } = bill;
        
        // Determine the correct paidStatus based on balanceAmount and dueDate
        let newStatus;
        if (balanceAmount === 0) {
            newStatus = 'Completed';
        } else if (dueDate && new Date(dueDate) < currentDate) {
            newStatus = 'Overdue';
        } else {
            newStatus = 'Pending';
        }

        // Update the bill's status only if it differs from the current status in the database
        if (newStatus !== currentStatus) {
            await Bills.updateOne({ _id: bill._id }, { paidStatus: newStatus });
        }
        }

        const formattedObjects = multiCustomDateTime(transformedBill, organizationExists.dateFormatExp, organizationExists.timeZoneExp, organizationExists.dateSplit );    

  
      res.status(200).json({allBills: formattedObjects});
    } catch (error) {
      console.error("Error fetching bills:", error);
      res.status(500).json({ message: "Internal server error." });
    }
  };
  
  
  // Get One Bill
  exports.getOneBill = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const billId = req.params.billId;
  
    const { organizationExists, bill } = await billsDataExist(organizationId, billId);
  
    if (!organizationExists) return res.status(404).json({ message: "Organization not found" });
     
    if (!bill) return res.status(404).json({ message: "No bill found" });

    const transformedBill = {
      ...bill,
      supplierId: bill.supplierId?._id,  
      supplierDisplayName: bill.supplierId?.supplierDisplayName,
      items: bill.items.map(item => ({
        ...item,
        itemId: item.itemId?._id,
        itemName: item.itemId?.itemName,
        itemImage: item.itemId?.itemImage,
      })),  
  };

    const formattedObjects = singleCustomDateTime(transformedBill, organizationExists.dateFormatExp, organizationExists.timeZoneExp, organizationExists.dateSplit );    

    res.status(200).json(formattedObjects);
  } catch (error) {
    console.error("Error fetching bill:", error);
    res.status(500).json({ message: "Internal server error." });
  }
  };




  // Get Invoice Journal
exports.billJournal = async (req, res) => {
  try {
      const organizationId = req.user.organizationId;
      const { billId } = req.params;

      const { billJournal } = await billsDataExist( organizationId, billId );      

      if (!billJournal) {
          return res.status(404).json({
              message: "No Journal found for the Bill.",
          });
      }

      const transformedJournal = billJournal.map(item => {
        return {
            ...item,
            accountId: item.accountId?._id,  
            accountName: item.accountId?.accountName,  
        };
    });

    console.log("Transformed Journal:", transformedJournal);
      
      res.status(200).json(transformedJournal);
  } catch (error) {
      console.error("Error fetching journal:", error);
      res.status(500).json({ message: "Internal server error." });
  }
};












  // Delete Purchase Order
  async function deletePurchaseOrder(purchaseOrderId, organizationId, res) {
    try {
      const deletedOrder = await PurchaseOrder.findOneAndDelete({ _id: purchaseOrderId, organizationId });
      if (!deletedOrder) {
        console.warn(`Purchase Order with ID: ${purchaseOrderId} not found for Organization: ${organizationId}`);
      }
      return deletedOrder;      
    } catch (error) {
      console.error(`Error deleting Purchase Order: ${error}`);
      res.status(500).json({ message: "Error deleting the Purchase Order." });
      return null;
    }
  }














  //Default Account
async function defaultAccounting( data, defaultAccount, organizationExists ) {
  // 1. Fetch required accounts
  const accounts = await accDataExists(
    organizationExists.organizationId, 
    data.otherExpenseAccountId, 
    data.freightAccountId, 
    data.paidAccountId
  );
   // 2. Check for missing required accounts
   const errorMessage = getMissingAccountsError(data, defaultAccount, accounts);
   if (errorMessage) {
     return { defAcc: null, error: errorMessage };
   }
   // 3. Update account references
  assignAccountReferences(data, defaultAccount, accounts);  
  return { defAcc: defaultAccount, error: null };
}

function getMissingAccountsError(data, defaultAccount, accounts) {
  const accountChecks = [
    // Tax account checks
    { condition: data.cgst, account: defaultAccount.inputCgst, message: "CGST Account" },
    { condition: data.sgst, account: defaultAccount.inputSgst, message: "SGST Account" },
    { condition: data.igst, account: defaultAccount.inputIgst, message: "IGST Account" },
    { condition: data.vat, account: defaultAccount.inputVat, message: "VAT Account" },
    
    // Transaction account checks
    { condition: data.totalDiscount, account: defaultAccount.purchaseDiscountAccount, message: "Discount Account" },
    { condition: data.otherExpenseAmount, account: accounts.otherExpenseAcc, message: "Other Expense Account" },
    { condition: data.freightAmount, account: accounts.freightAcc, message: "Freight Account" },
    { condition: data.paidAmount, account: accounts.paidAcc, message: "Paid Through Account" }
  ];

  const missingAccounts = accountChecks
    .filter(({ condition, account }) => condition && !account)
    .map(({ message }) => `${message} not found`);

  return missingAccounts.length ? missingAccounts.join(". ") : null;
}

function assignAccountReferences(data, defaultAccount, accounts) {
  if (data.otherExpenseAmount) {
    defaultAccount.otherExpenseAccountId = accounts.otherExpenseAcc?._id;
  }
  if (data.freightAmount) {
    defaultAccount.freightAccountId = accounts.freightAcc?._id;
  }
  if (data.paidAmount) {
    defaultAccount.paidAccountId = accounts.paidAcc?._id;
  }
}

  
  
  



















// Get last bill prefix
exports.getLastBillsPrefix = async (req, res) => {
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
      const lastPrefix = series.bill + series.billNum;

      lastPrefix.organizationId = undefined;

      res.status(200).json(lastPrefix);
  } catch (error) {
      console.error("Error fetching accounts:", error);
      res.status(500).json({ message: "Internal server error." });
  }
};

// Credit Note Prefix
function billsPrefix( cleanData, existingPrefix ) {
  const activeSeries = existingPrefix.series.find(series => series.status === true);
  if (!activeSeries) {
      return res.status(404).json({ message: "No active series found for the organization." });
  }
  cleanData.billNumber = `${activeSeries.bill}${activeSeries.billNum}`;

  activeSeries.billNum += 1;

  existingPrefix.save() 
}









  // Create New Debit Note
  function createNewBills( data, organizationId, userId, userName ) {
    const newBill = new Bills({ ...data, organizationId, userId, userName });
    return newBill.save();
  }


  // Check for existing bill
  // async function checkExistingBill(billNumber, organizationId, res) {
  //   const existingBill = await Bills.findOne({ billNumber, organizationId });
  //   if (existingBill) {
  //     res.status(409).json({ message: "Bill already exists." });
  //     return true;
  //   }
  //   return false;
  // }
  
  
  
  
  // Validate Organization Tax Currency
  function validateOrganizationSupplierOrder( organizationExists, supplierExist, existingPrefix, defaultAccount, res ) {
    if (!organizationExists) {
      res.status(404).json({ message: "Organization not found" });
      return false;
    }
    if (!supplierExist) {
      res.status(404).json({ message: "Supplier not found." });
      return false;
    }
    if (!existingPrefix) {
      res.status(404).json({ message: "Prefix not found" });
      return false;
    }
    if (!defaultAccount) {
    res.status(404).json({ message: "Setup Accounts in settings" });
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





  function calculateBills(cleanedData, itemTable, res) {
    
    const errors = [];
  
    let otherExpense = (parseFloat(cleanedData.otherExpenseAmount) || 0);
    let freightAmount = (parseFloat(cleanedData.freightAmount) || 0);
    let roundOffAmount = (parseFloat(cleanedData.roundOffAmount) || 0);
    
    let totalDiscount= 0;
    
    let subTotal = 0;
    let totalTaxAmount = 0;
    let itemTotalDiscount= 0;
    let totalItem = 0;
    let transactionDiscountAmount = 0;
    let grandTotal = 0;
    let balanceAmount = 0;
    let paidAmount = (cleanedData.paidAmount || 0);

    let purchaseAmount =0;

  
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
      const itemDiscAmt = calculateItemDiscount(item);
  
      itemTotalDiscount +=  parseFloat(itemDiscAmt);
      totalItem +=  parseInt(item.itemQuantity);
      subTotal += parseFloat(item.itemQuantity * item.itemCostPrice);
      purchaseAmount +=(item.itemCostPrice * item.itemQuantity);
      totalDiscount +=  parseFloat(itemDiscAmt);
  
      const withoutTaxAmount = (item.itemCostPrice * item.itemQuantity - itemDiscAmt);
  
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
        console.log("totalTaxAmount:",totalTaxAmount);
  
      } else {
        console.log(`Skipping Tax for Non-Taxable item: ${item.itemName}`);
        console.log(`Item: ${item.itemName}, Calculated Discount: ${itemDiscAmt}`);
      }

      itemAmount = (withoutTaxAmount + calculatedItemTaxAmount);
  
      checkAmount(itemAmount, item.itemAmount, item.itemName, 'Item Total',errors);
  
      console.log(`${item.itemName} Item Total: ${itemAmount} , Provided ${item.itemAmount}`);
      console.log(`${item.itemName} Total Tax: ${calculatedItemTaxAmount} , Provided ${item.itemTax || 0 }`);
      console.log("");
    });

      //Purchase amount
    cleanedData.purchaseAmount=purchaseAmount;    

  
    const total = roundToTwoDecimals((subTotal + totalTaxAmount + otherExpense + freightAmount - roundOffAmount) - itemTotalDiscount );
          
    console.log(`Sub Total: ${subTotal} , Provided ${cleanedData.subTotal}`);
    console.log(`Total: ${total} , Provided ${total}`);
    console.log(`Sub Total: ${subTotal} , Provided ${cleanedData.subTotal}`);
    console.log(`Total Tax Amount: ${totalTaxAmount} , Provided ${cleanedData.totalTaxAmount}`);
    console.log(`Other Expense: ${otherExpense} , Provided ${cleanedData.otherExpenseAmount}`);
    console.log(`Freight Amount: ${freightAmount} , Provided ${cleanedData.freightAmount}`);
    console.log(`Round Off Amount: ${roundOffAmount} , Provided ${cleanedData.roundOffAmount}`);
    console.log(`Item Total Discount: ${itemTotalDiscount} , Provided ${cleanedData.itemTotalDiscount}`);
  
    // Transaction Discount
    let transDisAmt = calculateTransactionDiscount( cleanedData, total ); 
  
    cleanedData.totalDiscount =  roundToTwoDecimals(totalDiscount + parseFloat(transDisAmt));

    // grandTotal amount calculation with including transactionDiscount
    
    grandTotal = roundToTwoDecimals(total - transDisAmt); 
    console.log(`Grand Total: ${grandTotal} , Provided ${cleanedData.grandTotal}`);

    // Calculate balanceAmount
    balanceAmount = grandTotal - parseFloat(paidAmount)
  
    // Round the totals for comparison
    const roundedSubTotal = roundToTwoDecimals(subTotal); 
    const roundedTotalTaxAmount = roundToTwoDecimals(totalTaxAmount);
    const roundedGrandTotalAmount = roundToTwoDecimals(grandTotal);
    const roundedTotalItemDiscount = roundToTwoDecimals(itemTotalDiscount);
    const roundedBalanceAmount = roundToTwoDecimals(balanceAmount); 
  
    console.log(`Final Sub Total: ${roundedSubTotal} , Provided ${cleanedData.subTotal}` );
    console.log(`Final Total Tax Amount: ${roundedTotalTaxAmount} , Provided ${cleanedData.totalTaxAmount}` );
    console.log(`Final Total Amount: ${roundedGrandTotalAmount} , Provided ${cleanedData.grandTotal}` );
    console.log(`Final Total Item Discount Amount: ${roundedTotalItemDiscount} , Provided ${cleanedData.itemTotalDiscount}` );
    console.log(`Final Balance Amount: ${roundedBalanceAmount} , Provided ${cleanedData.balanceAmount}` );
  
    validateAmount(roundedSubTotal, ( cleanedData.subTotal || 0 ), 'SubTotal', errors);
    validateAmount(roundedTotalTaxAmount, ( cleanedData.totalTaxAmount || 0 ), 'Total Tax Amount', errors);
    validateAmount(roundedGrandTotalAmount, ( cleanedData.grandTotal || 0 ), 'Grand Total', errors);
    validateAmount(roundedTotalItemDiscount, ( cleanedData.itemTotalDiscount || 0 ), 'Total Item Discount Amount', errors);
    validateAmount(roundedBalanceAmount, ( cleanedData.balanceAmount || 0 ), 'Balance Amount', errors);
    validateAmount(totalItem, ( cleanedData.totalItem || 0 ), 'Total Item count', errors);
  
    if (errors.length > 0) {
      res.status(400).json({ message: errors.join(", ") });
      return false;
    }
  
    return true;
  }
  
  
  // Calculate item discount
  function calculateItemDiscount(item) {
    return item.itemDiscountType === 'currency'
      ? item.itemDiscount || 0
      : (item.itemCostPrice * item.itemQuantity * (item.itemDiscount || 0)) / 100;    //if percentage
  }
  
  
  //TransactionDiscount
  function calculateTransactionDiscount(cleanedData, total ) {
    const discountAmount = cleanedData.transactionDiscount || 0;

  
    return cleanedData.transactionDiscountType === 'currency'
      ? discountAmount
      : (total * (discountAmount)) / 100;    
  }
  
  
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
function validateInputs( data, supplierExist, items, itemExists, organizationExists, defaultAccount, res) {
    const validationErrors = validateBillsData(data, supplierExist, items, itemExists, organizationExists, defaultAccount );  
  
    if (validationErrors.length > 0) {
      res.status(400).json({ message: validationErrors.join(", ") })
      ;
      return false;
    }
    return true;
  }
  
  //Validate Data
  function validateBillsData( data, supplierExist, items, itemTable, organizationExists, defaultAccount ) {
    const errors = [];
  
    // console.log("Item Request :",items);
    // console.log("Item Fetched :",itemTable);
  
    //Basic Info
    validateReqFields( data, supplierExist, defaultAccount, errors );
    validateItemTable(items, itemTable, errors);
    // Activate `validatePurchaseOrderData` only when `purchaseOrderId` is present
    // if (data.purchaseOrderId) {
    //   validatePurchaseOrderData(data, purchaseOrderExist, items, errors);
    // }
    validateShipmentPreferences(data.shipmentPreference, errors)
    validateTransactionDiscountType(data.transactionDiscountType, errors);
    // console.log("billExist Data:", billExist.billNumber, billExist.billDate, billExist.orderNumber)
  
    //OtherDetails
    validateIntegerFields(['totalItem'], data, errors);
    validateFloatFields(['transactionDiscountAmount','subTotal','cgst','sgst','igst','vat','totalTaxAmount','grandTotal'], data, errors);
    //validateAlphabetsFields(['department', 'designation'], data, errors);
  
    //Tax Details
    //validateTaxType(data.taxType, validTaxTypes, errors);
    validateSourceOfSupply(data.sourceOfSupply, organizationExists, errors);
    validateDestinationOfSupply(data.destinationOfSupply, organizationExists, errors);
    validatePaymentTerms(data.paymentTerms, errors);
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
  function validateReqFields( data, supplierExist, defaultAccount, errors ) {
  validateField( typeof data.supplierId === 'undefined', "Please select a Supplier", errors );
  validateField( typeof data.billDate === 'undefined', "Please select Bill date", errors );
  
  validateField( supplierExist.taxType == 'GST' && typeof data.sourceOfSupply === 'undefined', "Source of supply required", errors  );
  validateField( supplierExist.taxType == 'GST' && typeof data.destinationOfSupply === 'undefined', "Destination of supply required", errors  );
  
  validateField( typeof data.items === 'undefined', "Select an item", errors  );
  validateField( Array.isArray(data.items) && data.items.length === 0, "Select an item", errors );
  validateField( typeof data.supplierInvoiceNum === 'undefined', "Select an supplier invoice number", errors  );

  validateField( typeof data.otherExpenseAmount !== 'undefined' && typeof data.otherExpenseReason === 'undefined', "Please enter other expense reason", errors  );
  validateField( typeof data.otherExpenseAmount !== 'undefined' && typeof data.otherExpenseAccountId === 'undefined', "Please select expense account", errors  );
  validateField( typeof data.freightAmount !== 'undefined' && typeof data.freightAccountId === 'undefined', "Please select freight account", errors  );

  validateField( typeof data.roundOffAmount !== 'undefined' && !(data.roundOffAmount >= 0 && data.roundOffAmount <= 1), "Round Off Amount must be between 0 and 1", errors );

  validateField( typeof data.paidAmount !== 'undefined' && !(data.paidAmount <= data.grandTotal), "Excess payment amount", errors );
  validateField( typeof data.paidAmount !== 'undefined' && !(data.paidAmount >= 0 ), "Negative payment amount", errors );

  validateField( typeof defaultAccount.purchaseDiscountAccount === 'undefined', "No Purchase Discount Account found", errors  );

  validateField( supplierExist.taxType === 'GST' && typeof defaultAccount.inputCgst === 'undefined', "No Input Cgst Account found", errors  );
  validateField( supplierExist.taxType === 'GST' && typeof defaultAccount.inputSgst === 'undefined', "No Input Sgst Account found", errors  );
  validateField( supplierExist.taxType === 'GST' && typeof defaultAccount.inputIgst === 'undefined', "No Input Igst Account found", errors  );
  validateField( supplierExist.taxType === 'VAT' && typeof defaultAccount.inputVat === 'undefined', "No Input Vat Account found", errors  );

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
    validateField( item.itemName !== fetchedItem.itemName, `Item Name Mismatch : ${item.itemName}`, errors );
  
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
    validateItemDiscountType(item.itemDiscountType, errors);
  
    // Validate integer fields
    validateIntegerFields(['itemQuantity'], item, errors);
  
    // Validate float fields
    validateFloatFields(['itemCostPrice', 'itemTotalTax', 'itemAmount'], item, errors);
  });
  }
  
  
  // validate purchase order data
  function validatePurchaseOrderData(data, purchaseOrderExist, items, errors) {  
    // console.log("data:", data);
    // console.log("purchaseOrderExist:", purchaseOrderExist);
    // console.log("items:", items);
  
     // Initialize `billExist.items` to an empty array if undefined
     purchaseOrderExist.items = Array.isArray(purchaseOrderExist.items) ? purchaseOrderExist.items : [];
  
    // Validate basic fields
    validateField( purchaseOrderExist.purchaseOrder !== data.orderNumber, `Order Number mismatch for ${purchaseOrderExist.purchaseOrder}`, errors  );
  
    // Loop through each item in billExist.items
    purchaseOrderExist.items.forEach(orderItem => {
      const bItem = items.find(dataItem => dataItem.itemId === orderItem.itemId);
  
      if (!bItem) {
        errors.push(`Item ID ${orderItem.itemId} not found in provided items`);
      } else {
        
        validateField(bItem.itemName !== orderItem.itemName, 
                      `Item Name mismatch for ${orderItem.itemId}: Expected ${orderItem.itemName}, got ${bItem.itemName}`, 
                      errors);
        validateField(bItem.itemCostPrice !== orderItem.itemCostPrice, 
                      `Item Cost Price mismatch for ${orderItem.itemId}: Expected ${orderItem.itemCostPrice}, got ${bItem.itemCostPrice}`, 
                      errors);
        validateField(bItem.itemCgst !== orderItem.itemCgst, 
                      `Item CGST mismatch for ${orderItem.itemId}: Expected ${orderItem.itemCgst}, got ${bItem.itemCgst}`, 
                      errors);
        validateField(bItem.itemSgst !== orderItem.itemSgst, 
                      `Item SGST mismatch for ${orderItem.itemId}: Expected ${orderItem.itemSgst}, got ${bItem.itemSgst}`, 
                      errors);
        validateField(bItem.itemIgst !== orderItem.itemIgst, 
                      `Item IGST mismatch for ${orderItem.itemId}: Expected ${orderItem.itemIgst}, got ${bItem.itemIgst}`, 
                      errors);
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

   // Validate Payment Terms
   function validateShipmentPreferences(shipmentPreference, errors) {
    validateField(
        shipmentPreference && !validShipmentPreferences.includes(shipmentPreference),
      "Invalid Shipment Preference: " + shipmentPreference, errors );
  }
  
  //Validate Discount Transaction Type
  function validateTransactionDiscountType(transactionDiscountType, errors) {
  validateField(transactionDiscountType && !validTransactionDiscountType.includes(transactionDiscountType),
    "Invalid Transaction Discount: " + transactionDiscountType, errors);
  } 
  
  //Validate Item Discount Transaction Type
  function validateItemDiscountType(itemDiscountType, errors) {
    validateField(itemDiscountType && !validItemDiscountType.includes(itemDiscountType),
      "Invalid Item Discount: " + itemDiscountType, errors);
  }
  
  // Validate Payment Terms
  function validatePaymentTerms(paymentTerms, errors) {
    validateField(
       paymentTerms && !validPaymentTerms.includes(paymentTerms),
      "Invalid Payment Terms: " + paymentTerms, errors );
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
      
            const debitAmount = roundToTwoDecimals(item.itemCostPrice * item.itemQuantity);
  
            if (!accountEntries[accountId]) {
              accountEntries[accountId] = { accountId, debitAmount: 0 };
            }
            // Accumulate the debit amount
            accountEntries[accountId].debitAmount += debitAmount;
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
  async function itemTrack(savedBills, itemTable) {
    const { items } = savedBills;
  
    for (const item of items) {

      const matchingItem = itemTable.find((entry) => 
        entry._id.toString() === item.itemId.toString() 
      );
  
      if (!matchingItem) {
        console.error(`Item with ID ${item.itemId} not found in itemTable`);
        continue; 
      }
    
  
      // Create a new entry for item tracking
      const newItemTrack = new ItemTrack({
        organizationId: savedBills.organizationId,
        operationId: savedBills._id,
        transactionId: savedBills.bill,
        action: "Bills",
        itemId: matchingItem._id,
        sellingPrice: matchingItem.itemSellingPrice,
        costPrice: matchingItem.itemCostPrice || 0, 
        debitQuantity: item.itemQuantity,
        createdDateTime: savedBills.createdDateTime  
      });
  
      const savedItemTrack = await newItemTrack.save();
      console.log("savedItemTrack",savedItemTrack);
  
    }
  }
  
  
  
  
  
  // Utility functions
  const validShipmentPreferences = ["Road", "Rail", "Air", "Sea", "Courier", "Hand Delivery", "Pickup"];
  const validItemDiscountType = ["percentage", "currency"];
  const validTransactionDiscountType = ["percentage", "currency"];
  const validPaymentMode = [ "Cash", "Credit" ]
  const validPaymentTerms = [
    "Net 15", 
    "Net 30", 
    "Net 45", 
    "Net 60", 
    "Pay Now", 
    "due on receipt", 
    "End of This Month", 
    "End of Next Month",
    "Custom"
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
      "Kanazawa",
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
  
  






























  
async function journal( savedBills, defAcc, supplierAccount ) {
    
  const discount = {
    organizationId: savedBills.organizationId,
    operationId: savedBills._id,
    transactionId: savedBills.billNumber,
    date: savedBills.createdDate,
    accountId: defAcc.purchaseDiscountAccount || undefined,
    action: "Purchase Bill",
    debitAmount: 0,
    creditAmount: savedBills.totalDiscount || 0,
    remark: savedBills.note,
    createdDateTime:savedBills.createdDateTime
  };
  // const purchase = {
  //   organizationId: savedBills.organizationId,
  //   operationId: savedBills._id,
  //   transactionId: savedBills.billNumber,
  //   date: savedBills.createdDate,
  //   accountId: defAcc.purchaseAccount || undefined,
  //   accountName: defAcc.purchaseAccountName || undefined,
  //   action: "Purchase Bill",
  //   debitAmount: savedBills.purchaseAmount,
  //   creditAmount: 0,
  //   remark: savedBills.note,
  // };
  const cgst = {
    organizationId: savedBills.organizationId,
    operationId: savedBills._id,
    transactionId: savedBills.billNumber,
    date: savedBills.createdDate,
    accountId: defAcc.inputCgst || undefined,
    action: "Purchase Bill",
    debitAmount: savedBills.cgst || 0,
    creditAmount: 0,
    remark: savedBills.note,
    createdDateTime:savedBills.createdDateTime
  };
  const sgst = {
    organizationId: savedBills.organizationId,
    operationId: savedBills._id,
    transactionId: savedBills.billNumber,
    date: savedBills.createdDate,
    accountId: defAcc.inputSgst || undefined,
    action: "Purchase Bill",
    debitAmount: savedBills.sgst || 0,
    creditAmount: 0,
    remark: savedBills.note,
    createdDateTime:savedBills.createdDateTime
  };
  const igst = {
    organizationId: savedBills.organizationId,
    operationId: savedBills._id,
    transactionId: savedBills.billNumber,
    date: savedBills.createdDate,
    accountId: defAcc.inputIgst || undefined,
    action: "Purchase Bill",
    debitAmount: savedBills.igst || 0,
    creditAmount: 0,
    remark: savedBills.note,
    createdDateTime:savedBills.createdDateTime
  };
  const vat = {
    organizationId: savedBills.organizationId,
    operationId: savedBills._id,
    transactionId: savedBills.billNumber,
    date: savedBills.createdDate,
    accountId: defAcc.inputVat || undefined,
    action: "Purchase Bill",
    debitAmount: savedBills.vat || 0,
    creditAmount: 0,
    remark: savedBills.note,
    createdDateTime:savedBills.createdDateTime
  };
  const supplier = {
    organizationId: savedBills.organizationId,
    operationId: savedBills._id,
    transactionId: savedBills.billNumber,
    date: savedBills.createdDate,
    accountId: supplierAccount._id || undefined,
    action: "Purchase Bill",
    debitAmount: 0,
    creditAmount: savedBills.grandTotal || 0,
    remark: savedBills.note,
    createdDateTime:savedBills.createdDateTime
  };
  const supplierPaid = {
    organizationId: savedBills.organizationId,
    operationId: savedBills._id,
    transactionId: savedBills.billNumber,
    date: savedBills.createdDate,
    accountId: supplierAccount._id || undefined,
    action: "Payment",
    debitAmount: savedBills.paidAmount || 0,
    creditAmount: 0,
    remark: savedBills.note,
    createdDateTime:savedBills.createdDateTime
  };
  const paidAccount = {
    organizationId: savedBills.organizationId,
    operationId: savedBills._id,
    transactionId: savedBills.billNumber,
    date: savedBills.createdDate,
    accountId: defAcc.paidAccountId || undefined,
    action: "Payment",
    debitAmount: 0,
    creditAmount: savedBills.paidAmount || 0,
    remark: savedBills.note,
    createdDateTime:savedBills.createdDateTime
  };
  const otherExpense = {
    organizationId: savedBills.organizationId,
    operationId: savedBills._id,
    transactionId: savedBills.billNumber,
    date: savedBills.createdDate,
    accountId: defAcc.otherExpenseAccountId || undefined,
    action: "Purchase Bill",
    debitAmount: savedBills.otherExpenseAmount || 0,
    creditAmount: 0,
    remark: savedBills.note,
    createdDateTime:savedBills.createdDateTime
  };
  const freight = {
    organizationId: savedBills.organizationId,
    operationId: savedBills._id,
    transactionId: savedBills.billNumber,
    date: savedBills.createdDate,
    accountId: defAcc.freightAccountId || undefined,
    action: "Purchase Bill",
    debitAmount: savedBills.freightAmount || 0,
    creditAmount: 0,
    remark: savedBills.note,
    createdDateTime:savedBills.createdDateTime
  };
  const roundOff = {
    organizationId: savedBills.organizationId,
    operationId: savedBills._id,
    transactionId: savedBills.billNumber,
    date: savedBills.createdDate,
    accountName: "Round Off",
    action: "Purchase Bill",
    debitAmount: 0,
    creditAmount: savedBills.roundOffAmount || 0,
    remark: savedBills.note,
    createdDateTime:savedBills.createdDateTime
  };

  let purchaseTotalDebit = 0;
  let purchaseTotalCredit = 0;

  if (Array.isArray(savedBills.purchaseJournal)) {
    savedBills.purchaseJournal.forEach((entry) => {

      console.log( "Account Log",entry.accountId, entry.debitAmount, entry.creditAmount );      

      purchaseTotalDebit += entry.debitAmount || 0;
      purchaseTotalCredit += entry.creditAmount || 0;

    });

    console.log("Total Debit Amount from savedBills:", purchaseTotalDebit);
    console.log("Total Credit Amount from savedBills:", purchaseTotalCredit);
  } else {
    console.error("SavedBills is not an array or is undefined.");
  }

  console.log("cgst", cgst.debitAmount,  cgst.creditAmount);
  console.log("sgst", sgst.debitAmount,  sgst.creditAmount);
  console.log("igst", igst.debitAmount,  igst.creditAmount);
  console.log("vat", vat.debitAmount,  vat.creditAmount);

  // console.log("purchase", purchase.debitAmount,  purchase.creditAmount);
  console.log("supplier", supplier.debitAmount,  supplier.creditAmount);
  console.log("discount", discount.debitAmount,  discount.creditAmount);

  
  console.log("otherExpense", otherExpense.debitAmount,  otherExpense.creditAmount);
  console.log("freight", freight.debitAmount,  freight.creditAmount);
  console.log("roundOff", roundOff.debitAmount,  roundOff.creditAmount);

  console.log("supplierPaid", supplierPaid.debitAmount,  supplierPaid.creditAmount);
  console.log("paidAccount", paidAccount.debitAmount,  paidAccount.creditAmount);

  // const  debitAmount = cgst.debitAmount  + sgst.debitAmount + igst.debitAmount +  vat.debitAmount + purchase.debitAmount + supplier.debitAmount + discount.debitAmount + otherExpense.debitAmount + freight.debitAmount + roundOff.debitAmount + supplierPaid.debitAmount + paidAccount.debitAmount ;
  // const  creditAmount = cgst.creditAmount  + sgst.creditAmount + igst.creditAmount +  vat.creditAmount + purchase.creditAmount + supplier.creditAmount + discount.creditAmount + otherExpense.creditAmount + freight.creditAmount + roundOff.creditAmount + supplierPaid.creditAmount + paidAccount.creditAmount ;
  const debitAmount = 
  cgst.debitAmount  + 
  sgst.debitAmount  + 
  igst.debitAmount  + 
  vat.debitAmount  + 
  purchaseTotalDebit + 
  supplier.debitAmount  + 
  discount.debitAmount  + 
  otherExpense.debitAmount  + 
  freight.debitAmount  + 
  roundOff.debitAmount  + 
  supplierPaid.debitAmount  + 
  paidAccount.debitAmount ;

const creditAmount = 
  cgst.creditAmount  + 
  sgst.creditAmount  + 
  igst.creditAmount  + 
  vat.creditAmount  + 
  purchaseTotalCredit  + 
  supplier.creditAmount  + 
  discount.creditAmount  + 
  otherExpense.creditAmount  + 
  freight.creditAmount  + 
  roundOff.creditAmount  + 
  supplierPaid.creditAmount  + 
  paidAccount.creditAmount ;

  console.log("Total Debit Amount: ", debitAmount );
  console.log("Total Credit Amount: ", creditAmount );

  // console.log( discount, sale, cgst, sgst, igst, vat, customer, otherExpense, freight, roundOff );


  //Purchase
  savedBills.purchaseJournal.forEach((entry) => {

    const data = {
      organizationId: savedBills.organizationId,
      operationId: savedBills._id,
      transactionId: savedBills.billNumber,
      date: savedBills.createdDateTime,
      accountId: entry.accountId || undefined,
      action: "Purchase Bill",
      debitAmount: entry.debitAmount || 0,
      creditAmount: 0,
      remark: savedBills.note,
      createdDateTime:savedBills.createdDateTime
    };
    
    createTrialEntry( data )

  });


  // createTrialEntry( purchase )

  //Tax
  if(savedBills.cgst){
    createTrialEntry( cgst )
  }
  if(savedBills.sgst){
    createTrialEntry( sgst )
  }
  if(savedBills.igst){
    createTrialEntry( igst )
  }
  if(savedBills.vat){
    createTrialEntry( vat )
  }

  //Discount  
  if(savedBills.totalDiscount){
    createTrialEntry( discount )
  }

  //Other Expense
  if(savedBills.otherExpenseAmount){
    createTrialEntry( otherExpense )
  }

  //Freight
  if(savedBills.freightAmount){
    createTrialEntry( freight )
  }
  
  //Round Off
  if(savedBills.roundOffAmount){
    createTrialEntry( roundOff )
  }
 
  //supplier
  createTrialEntry( supplier )
  
  //Paid
  if(savedBills.paidAmount){
    createTrialEntry( supplierPaid )
    createTrialEntry( paidAccount )
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

await newTrialEntry.save();

}











exports.dataExist = {
  dataExist,
  itemDataExists,
  accDataExists,
  billsDataExist
};
exports.validation = {
  validateOrganizationSupplierOrder, 
  validateInputs
};
exports.calculation = { 
  taxType,
  calculateBills
};
exports.accounts = { 
  defaultAccounting,
  purchaseJournal,
  journal
};