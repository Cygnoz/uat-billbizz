
const mongoose = require('mongoose');
const Bills = require('../../database/model/bills');
const PaymentMade = require('../../database/model/paymentMade');
const TrialBalance = require("../../database/model/trialBalance");
const ItemTrack = require("../../database/model/itemTrack");
const { dataExist, validation, calculation, accounts } = require("../Bills/billsController");
const { cleanData } = require("../../services/cleanData");
const SupplierHistory = require("../../database/model/supplierHistory");

const { ObjectId } = require('mongodb');
const moment = require("moment-timezone");

// Update Purchase Bill 
exports.updateBill = async (req, res) => {
    console.log("Update bill:", req.body);
  
    try {
      const { organizationId, id: userId, userName } = req.user;
      const { billId } = req.params;   
      
      // Check if the billId exists in PaymentMade schema
      const existingPaymentMade = await PaymentMade.findOne({
        organizationId,
        "unpaidBills.billId": billId,
      });

      if (existingPaymentMade) {
        console.log(`Bill ID ${billId} exists in PaymentMade. Modification not allowed.`);
        return res.status(400).json({
          message: `This bill is associated with a Payment Made and cannot be modified.`,
        });
      }

      // Fetch existing bill
      const existingBill = await Bills.findOne({ _id: billId, organizationId });
      if (!existingBill) {
        console.log("Bill not found with ID:", billId);
        return res.status(404).json({ message: "Bill not found" });
      }

      // Clean input data
      const cleanedData = cleanData(req.body);

      const { items, supplierId, supplierDisplayName, purchaseOrderId, otherExpenseAccountId, freightAccountId, paidAccountId } = cleanedData;

      const itemIds = items.map(item => item.itemId);
    
      // Validate _id's
      const validateAllIds = validateIds({
        supplierId,
        otherExpenseAccountId,
        freightAccountId,
        paidAccountId,
        purchaseOrderId,
        itemIds,
        cleanedData
      });
      if (validateAllIds) {
        return res.status(400).json({ message: validateAllIds });
      }

      // Ensure purchase order fields match
      if (cleanedData.orderNumber && cleanedData.orderNumber !== existingBill.orderNumber) {
        return res.status(400).json({
          message: `The provided order number does not match the existing record. Expected: ${existingBill.orderNumber}`,
        });
      }
  
      // Ensure `billNumber` field matches the existing bill
      if (cleanedData.billNumber !== existingBill.billNumber) {
        return res.status(400).json({
          message: `The provided billNumber does not match the existing record. Expected: ${existingBill.billNumber}`,
        });
      }

      // Fetch related data
      const { organizationExists, supplierExist, existingPrefix, defaultAccount, supplierAccount } = await dataExist.dataExist( organizationId, supplierId, supplierDisplayName, purchaseOrderId );  
      
      // // Check if bill editing is allowed
      // if (settings.billEdit !== true) {
      //   return res.status(404).json({ message: "Editing bill is not allowed in the current settings." });
      // } 
      
      const { itemTable } = await dataExist.itemDataExists( organizationId, items );
  
      //Data Exist Validation
      if (!validation.validateOrganizationSupplierOrder( organizationExists, supplierExist, existingPrefix, defaultAccount, res )) return;
        
      // Validate Inputs
      if (!validation.validateInputs(cleanedData, supplierExist, items, itemTable, organizationExists, defaultAccount, res)) return;
  
      // Tax Type 
      calculation.taxType(cleanedData, supplierExist);

      //Default Account
      const { defAcc, error } = await accounts.defaultAccounting( cleanedData, defaultAccount, organizationExists );
      if (error) { 
        res.status(400).json({ message: error }); 
        return false; 
      }
  
      // Calculate Sales Order
      if (!calculation.calculateBills(cleanedData, itemTable, res)) return;

      //Sales Journal      
      if (!accounts.purchaseJournal( cleanedData, res )) return;
      
      cleanedData.createdDateTime = moment.tz(cleanedData.billDate, "YYYY-MM-DDTHH:mm:ss.SSS[Z]", organizationExists.timeZoneExp).toISOString();           

      const mongooseDocument = Bills.hydrate(existingBill);
      Object.assign(mongooseDocument, cleanedData);
      const savedBill = await mongooseDocument.save();
      if (!savedBill) {
        return res.status(500).json({ message: "Failed to update bill" });
      }

      // Add entry to Supplier History
      const supplierHistoryEntry = new SupplierHistory({
        organizationId,
        operationId: savedBill._id,
        supplierId,
        title: "Purchase Bill Updated",
        description: `Purchase Bill ${savedBill.billNumber} updated by ${userName}`,  
        userId: userId,
        userName: userName,
      });
  
      await supplierHistoryEntry.save();

      //Journal
      await journal( savedBill, defAcc, supplierAccount );
      
      //Item Track
      await itemTrack( savedBill, itemTable, organizationId, billId );
  
      res.status(200).json({ message: "Bill updated successfully", savedBill });
      // console.log("Bill updated successfully:", savedBill);
  
    } catch (error) {
      console.error("Error updating bill:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  };





   // Delete Purchase Bill
   exports.deletePurchaseBill = async (req, res) => {
    console.log("Delete purchase bill request received:", req.params);

    try {
        const { organizationId, id: userId, userName } = req.user;
        const { billId } = req.params;

        // Validate billId
        if (!mongoose.Types.ObjectId.isValid(billId) || billId.length !== 24) {
            return res.status(400).json({ message: `Invalid Purchase Bill ID: ${billId}` });
        }

        // Check if the billId exists in paymentMade schema
        const existingPaymentMade = await PaymentMade.findOne({
          organizationId,
          "unpaidBills.billId": billId,
        });
        if (existingPaymentMade) {
          console.log(`Bill ID ${billId} exists in paymentMade. Cannot be deleted.`);
          return res.status(400).json({
            message: `This bill is associated with a paymentMade and cannot be deleted.`,
          });
        }

        // Fetch existing purchase bill
        const existingPurchaseBill = await Bills.findOne({ _id: billId, organizationId });
        if (!existingPurchaseBill) {
            console.log("Purchase bill not found with ID:", billId);
            return res.status(404).json({ message: "Purchase bill not found" });
        }

        // Fetch existing itemTrack entries
        const existingItemTracks = await ItemTrack.find({ organizationId, operationId: billId });
        // Delete existing itemTrack entries for the operation
        if (existingItemTracks.length > 0) {
          await ItemTrack.deleteMany({ organizationId, operationId: billId });
          console.log(`Deleted existing itemTrack entries for operationId: ${billId}`);
        }

        // Fetch existing TrialBalance's createdDateTime
        const existingTrialBalance = await TrialBalance.findOne({
          organizationId: existingPurchaseBill.organizationId,
          operationId: existingPurchaseBill._id,
        });  
        // If there are existing entries, delete them
        if (existingTrialBalance) {
          await TrialBalance.deleteMany({
            organizationId: existingPurchaseBill.organizationId,
            operationId: existingPurchaseBill._id,
          });
          console.log(`Deleted existing TrialBalance entries for operationId: ${existingPurchaseBill._id}`);
        }

        // Add entry to Supplier History
        const supplierHistoryEntry = new SupplierHistory({
          organizationId,
          operationId: existingPurchaseBill._id,
          supplierId: existingPurchaseBill.supplierId,
          title: "Purchase Bill Deleted",
          description: `Purchase Bill ${existingPurchaseBill.billNumber} deleted by ${userName}`,  
          userId: userId,
          userName: userName,
        });

        // Delete the purchase bill
        const deletedPurchaseBill = await existingPurchaseBill.deleteOne();
        if (!deletedPurchaseBill) {
            console.error("Failed to delete purchase bill.");
            return res.status(500).json({ message: "Failed to delete purchase bill" });
        }
    
        await supplierHistoryEntry.save();

        res.status(200).json({ message: "Purchase bill deleted successfully" });
        console.log("Purchase bill deleted successfully with ID:", billId);

    } catch (error) {
        console.error("Error deleting purchase bill:", error);
        res.status(500).json({ message: "Internal server error" });
    }
  };










  function validateIds({ supplierId, otherExpenseAccountId, freightAccountId, paidAccountId, purchaseOrderId, itemIds, cleanedData }) {
    // Validate Supplier ID
    if (!mongoose.Types.ObjectId.isValid(supplierId) || supplierId.length !== 24) {
      return res.status(400).json({ message: `Invalid supplier ID: ${supplierId}` });
    }
  
    // Validate Other Expense Account ID if applicable
    if ((!mongoose.Types.ObjectId.isValid(otherExpenseAccountId) || otherExpenseAccountId.length !== 24) && cleanedData.otherExpenseAmount !== undefined) {
      return "Select other expense account";
    }
  
    // Validate Freight Account ID if applicable
    if ((!mongoose.Types.ObjectId.isValid(freightAccountId) || freightAccountId.length !== 24) && cleanedData.freightAmount !== undefined) {
      return "Select freight account";
    }
  
    // Validate Deposit Account ID if applicable
    if ((!mongoose.Types.ObjectId.isValid(paidAccountId) || paidAccountId.length !== 24) && cleanedData.paidAccountId !== undefined) {
      return "Select deposit account";
    }

    if (purchaseOrderId) {
      if (!mongoose.Types.ObjectId.isValid(purchaseOrderId) || purchaseOrderId.length !== 24) {
        return res.status(400).json({ message: `Invalid Purchase Order ID: ${purchaseOrderId}` });
      }
    }
  
    // Validate Item IDs
    const invalidItemIds = itemIds.filter(itemId => !mongoose.Types.ObjectId.isValid(itemId) || itemId.length !== 24);
    if (invalidItemIds.length > 0) {
      return `Invalid item IDs: ${invalidItemIds.join(', ')}`;
    }
  
    // Check for duplicate Item IDs
    const uniqueItemIds = new Set(itemIds);
    if (uniqueItemIds.size !== itemIds.length) {
      return "Duplicate Item found in the list.";
    }
  
    // Return null if all validations pass
    return null;
  }
  




  

  // Item Track Function
  async function itemTrack(savedBill, itemTable, organizationId, billId) {

      await ItemTrack.deleteMany({ organizationId, operationId: billId });
      
      const { items } = savedBill;

      for (const item of items) {

        const matchingItem = itemTable.find((entry) => 
          entry._id.toString() === item.itemId.toString() 
        );
    
        if (!matchingItem) {
          console.error(`Item with ID ${item.itemId} not found in itemTable`);
          continue; // Skip this entry if not found
        }    
    
        // Create a new entry for item tracking
        const newTrialEntry = new ItemTrack({
          organizationId: savedBill.organizationId,
          operationId: savedBill._id,
          transactionId: savedBill.bill,
          action: "Bills",
          itemId: matchingItem._id,
          sellingPrice: matchingItem.itemSellingPrice,
          costPrice: matchingItem.itemCostPrice || 0, 
          debitQuantity: item.itemQuantity, 
          createdDateTime: savedBill.createdDateTime 
        });
    
        // Save the tracking entry and update the item's stock in the item table
        await newTrialEntry.save();

        
      }
  }









  async function journal( savedBill, defAcc, supplierAccount ) { 
    

    await TrialBalance.deleteMany({
        organizationId: savedBill.organizationId,
        operationId: savedBill._id,
    });

    
    const discount = {
      organizationId: savedBill.organizationId,
      operationId: savedBill._id,
      transactionId: savedBill.billNumber,
      date: savedBill.createdDate,
      accountId: defAcc.purchaseDiscountAccount || undefined,
      action: "Purchase Bill",
      debitAmount: 0,
      creditAmount: savedBill.totalDiscount || 0,
      remark: savedBill.note,
      createdDateTime:savedBill.createdDateTime
    };
    // const purchase = {
    //   organizationId: savedBill.organizationId,
    //   operationId: savedBill._id,
    //   transactionId: savedBill.billNumber,
    //   date: savedBill.createdDate,
    //   accountId: defAcc.purchaseAccount || undefined,
    //   accountName: defAcc.purchaseAccountName || undefined,
    //   action: "Purchase Bill",
    //   debitAmount: savedBill.purchaseAmount,
    //   creditAmount: 0,
    //   remark: savedBill.note,
    // };
    const cgst = {
      organizationId: savedBill.organizationId,
      operationId: savedBill._id,
      transactionId: savedBill.billNumber,
      date: savedBill.createdDate,
      accountId: defAcc.inputCgst || undefined,
      action: "Purchase Bill",
      debitAmount: savedBill.cgst || 0,
      creditAmount: 0,
      remark: savedBill.note,
      createdDateTime:savedBill.createdDateTime
    };
    const sgst = {
      organizationId: savedBill.organizationId,
      operationId: savedBill._id,
      transactionId: savedBill.billNumber,
      date: savedBill.createdDate,
      accountId: defAcc.inputSgst || undefined,
      action: "Purchase Bill",
      debitAmount: savedBill.sgst || 0,
      creditAmount: 0,
      remark: savedBill.note,
      createdDateTime:savedBill.createdDateTime
    };
    const igst = {
      organizationId: savedBill.organizationId,
      operationId: savedBill._id,
      transactionId: savedBill.billNumber,
      date: savedBill.createdDate,
      accountId: defAcc.inputIgst || undefined,
      action: "Purchase Bill",
      debitAmount: savedBill.igst || 0,
      creditAmount: 0,
      remark: savedBill.note,
      createdDateTime:savedBill.createdDateTime
    };
    const vat = {
      organizationId: savedBill.organizationId,
      operationId: savedBill._id,
      transactionId: savedBill.billNumber,
      date: savedBill.createdDate,
      accountId: defAcc.inputVat || undefined,
      action: "Purchase Bill",
      debitAmount: savedBill.vat || 0,
      creditAmount: 0,
      remark: savedBill.note,
      createdDateTime:savedBill.createdDateTime
    };
    const supplier = {
      organizationId: savedBill.organizationId,
      operationId: savedBill._id,
      transactionId: savedBill.billNumber,
      date: savedBill.createdDate,
      accountId: supplierAccount._id || undefined,
      action: "Purchase Bill",
      debitAmount: 0,
      creditAmount: savedBill.grandTotal || 0,
      remark: savedBill.note,
      createdDateTime:savedBill.createdDateTime
    };
    const supplierPaid = {
      organizationId: savedBill.organizationId,
      operationId: savedBill._id,
      transactionId: savedBill.billNumber,
      date: savedBill.createdDate,
      accountId: supplierAccount._id || undefined,
      action: "Payment",
      debitAmount: savedBill.paidAmount || 0,
      creditAmount: 0,
      remark: savedBill.note,
      createdDateTime:savedBill.createdDateTime
    };
    const paidAccount = {
      organizationId: savedBill.organizationId,
      operationId: savedBill._id,
      transactionId: savedBill.billNumber,
      date: savedBill.createdDate,
      accountId: defAcc.paidAccountId || undefined,
      action: "Payment",
      debitAmount: 0,
      creditAmount: savedBill.paidAmount || 0,
      remark: savedBill.note,
      createdDateTime:savedBill.createdDateTime
    };
    const otherExpense = {
      organizationId: savedBill.organizationId,
      operationId: savedBill._id,
      transactionId: savedBill.billNumber,
      date: savedBill.createdDate,
      accountId: defAcc.otherExpenseAccountId || undefined,
      action: "Purchase Bill",
      debitAmount: savedBill.otherExpenseAmount || 0,
      creditAmount: 0,
      remark: savedBill.note,
      createdDateTime:savedBill.createdDateTime
    };
    const freight = {
      organizationId: savedBill.organizationId,
      operationId: savedBill._id,
      transactionId: savedBill.billNumber,
      date: savedBill.createdDate,
      accountId: defAcc.freightAccountId || undefined,
      action: "Purchase Bill",
      debitAmount: savedBill.freightAmount || 0,
      creditAmount: 0,
      remark: savedBill.note,
      createdDateTime:savedBill.createdDateTime
    };
    const roundOff = {
      organizationId: savedBill.organizationId,
      operationId: savedBill._id,
      transactionId: savedBill.billNumber,
      date: savedBill.createdDate,
      accountName: "Round Off",
      action: "Purchase Bill",
      debitAmount: 0,
      creditAmount: savedBill.roundOffAmount || 0,
      remark: savedBill.note,
      createdDateTime:savedBill.createdDateTime
    };

    let purchaseTotalDebit = 0;
    let purchaseTotalCredit = 0;

    if (Array.isArray(savedBill.purchaseJournal)) {
      savedBill.purchaseJournal.forEach((entry) => {
  
        console.log( "Account Log",entry.accountId, entry.debitAmount, entry.creditAmount );      
  
        purchaseTotalDebit += entry.debitAmount || 0;
        purchaseTotalCredit += entry.creditAmount || 0;
  
      });
  
      console.log("Total Debit Amount from savedBill:", purchaseTotalDebit);
      console.log("Total Credit Amount from savedBill:", purchaseTotalCredit);
    } else {
      console.error("SavedBill is not an array or is undefined.");
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


    //Sales
    savedBill.purchaseJournal.forEach((entry) => {
      const data = {
        organizationId: savedBill.organizationId,
        operationId: savedBill._id,
        transactionId: savedBill.billNumber,
        date: savedBill.createdDateTime,
        accountId: entry.accountId || undefined,
        action: "Purchase Bill",
        debitAmount: entry.debitAmount || 0,
        creditAmount: 0,
        remark: savedBill.note,
        createdDateTime:savedBill.createdDateTime
      };
      createTrialEntry( data )
    });

      
  



    // createTrialEntry( purchase )

  //Tax
  if(savedBill.cgst){
    createTrialEntry( cgst )
  }
  if(savedBill.sgst){
    createTrialEntry( sgst )
  }
  if(savedBill.igst){
    createTrialEntry( igst )
  }
  if(savedBill.vat){
    createTrialEntry( vat )
  }

  //Discount  
  if(savedBill.totalDiscount){
    createTrialEntry( discount )
  }

  //Other Expense
  if(savedBill.otherExpenseAmount){
    createTrialEntry( otherExpense )
  }

  //Freight
  if(savedBill.freightAmount){
    createTrialEntry( freight )
  }
  
  //Round Off
  if(savedBill.roundOffAmount){
    createTrialEntry( roundOff )
  }
 
  //supplier
  createTrialEntry( supplier )
  
  //Paid
  if(savedBill.paidAmount){
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
      createdDateTime: data.createdDateTime,
    });
    
    await newTrialEntry.save();
  }