const Organization = require("../database/model/organization");
const Item = require("../database/model/item");
const ItemTrack = require("../database/model/itemTrack");
const Settings = require("../database/model/settings");
const BMCR = require("../database/model/bmcr");
const Tax = require("../database/model/tax");
const Account = require("../database/model/account")
const moment = require("moment-timezone");

const { cleanData } = require("../services/cleanData");
const Supplier = require("../database/model/supplier");

const mongoose = require('mongoose');



// Fetch existing data
const dataExist = async ( organizationId, salesAccountId = null , purchaseAccountId = null ) => {  
  const [ organizationExists, taxExists, allItem, settingsExist, salesAccount, purchaseAccount ] = await Promise.all([
    Organization.findOne({ organizationId }),
    Tax.findOne({ organizationId }),
    Item.find({ organizationId }),
    Settings.findOne({ organizationId }),
    Account.findOne({ organizationId , _id : salesAccountId}),
    Account.findOne({ organizationId , _id : purchaseAccountId}),
  ]);
  return { organizationExists, taxExists, allItem, settingsExist,  salesAccount, purchaseAccount };
};



//Xs Item Exist
const xsItemDataExists = async (organizationId) => {
                const [newItems] = await Promise.all([
                  Item.find( { organizationId }, { _id: 1, itemName: 1, itemImage: 1, taxPreference: 1, sellingPrice: 1, salesAccountId:1, purchaseAccountId:1, costPrice:1, taxRate: 1, cgst: 1, sgst: 1, igst: 1, vat: 1 } )
                  .populate('salesAccountId', 'accountName') 
                  .populate('purchaseAccountId', 'accountName') 
                  .lean(),                  
                ]);     
                
                
                const transformedItems = newItems.map(item => ({
                  ...item,
                  salesAccountId: item.salesAccountId?._id || undefined,
                  salesAccountName: item.salesAccountId?.accountName || undefined,
                  
                  purchaseAccountId: item.purchaseAccountId?._id || undefined,
                  purchaseAccountName: item.purchaseAccountId?.accountName || undefined,
                }));

                // Extract itemIds from newItems
                const itemIds = transformedItems.map(item => new mongoose.Types.ObjectId(item._id));
              

                // Aggregate data from ItemTrack
                const itemTracks = await ItemTrack.aggregate([
                  { $match: { itemId: { $in: itemIds } } },
                  { $sort: { itemId: 1, createdDateTime: 1 } }, // Sort by itemId and createdDateTime
                  {
                      $group: {
                          _id: "$itemId",
                          totalCredit: { $sum: "$creditQuantity" },
                          totalDebit: { $sum: "$debitQuantity" },
                          lastEntry: { $max: "$createdDateTime" }, // Identify the last date explicitly
                          data: { $push: "$$ROOT" }, // Push all records to process individually if needed
                      },
                  },
                ]);
                

                const itemTrackMap = itemTracks.reduce((acc, itemTrack) => {
                  const sortedEntries = itemTrack.data.sort((a, b) =>
                      new Date(a.createdDateTime) - new Date(b.createdDateTime)
                  );
            
                  acc[itemTrack._id.toString()] = {
                      currentStock: itemTrack.totalDebit - itemTrack.totalCredit,
                      lastEntry: sortedEntries[sortedEntries.length - 1], // Explicitly take the last entry based on sorted data
                  };
                  return acc;
                }, {});

                // Enrich items with currentStock and other data
                const enrichedItems = transformedItems.map(item => {
                  const itemIdStr = item._id.toString();
                  const itemTrackData = itemTrackMap[itemIdStr];
                
                  if (!itemTrackData) {
                      console.warn(`No ItemTrack data found for itemId: ${itemIdStr}`);
                  }
                
                  return {
                      ...item,
                      currentStock: itemTrackData?.currentStock ?? 0, 
                  };
                });

                return { enrichedItems };
};


//M Item Exist
const mItemDataExists = async (organizationId) => {
  const [newItems] = await Promise.all([
      Item.find({ organizationId }, { organizationId: 0 })
          .populate('salesAccountId', 'accountName')
          .populate('purchaseAccountId', 'accountName')
          .populate('preferredVendorId', 'supplierDisplayName')
          .lean(),
  ]);

  const transformedItems = newItems.map(item => ({
      ...item,
      salesAccountId: item.salesAccountId?._id || undefined,
      salesAccountName: item.salesAccountId?.accountName || undefined,

      purchaseAccountId: item.purchaseAccountId?._id || undefined,
      purchaseAccountName: item.purchaseAccountId?.accountName || undefined,

      preferredVendorId: item.preferredVendorId?._id || undefined,
      preferredVendorName: item.preferredVendorId?.supplierDisplayName || undefined,
  }));

  // Extract itemIds from newItems
  const itemIds = transformedItems.map(item => new mongoose.Types.ObjectId(item._id));

  // Aggregate data from ItemTrack
  const itemTracks = await ItemTrack.aggregate([
      { $match: { itemId: { $in: itemIds } } },
      { $sort: { itemId: 1, createdDateTime: 1 } }, // Sort by itemId and createdDateTime
      {
          $group: {
              _id: "$itemId",
              totalCredit: { $sum: "$creditQuantity" },
              totalDebit: { $sum: "$debitQuantity" },
              lastEntry: { $max: "$createdDateTime" }, // Identify the last date explicitly
              data: { $push: "$$ROOT" }, // Push all records to process individually if needed
          },
      },
  ]);

  
  
  const itemTrackMap = itemTracks.reduce((acc, itemTrack) => {
      const sortedEntries = itemTrack.data.sort((a, b) =>
          new Date(a.createdDateTime) - new Date(b.createdDateTime)
      );

      acc[itemTrack._id.toString()] = {
          currentStock: itemTrack.totalDebit - itemTrack.totalCredit,
          lastEntry: sortedEntries[sortedEntries.length - 1], // Explicitly take the last entry based on sorted data
      };
      return acc;
  }, {});

  // Enrich items with currentStock and other data
  const enrichedItems = transformedItems.map(item => {
    const itemIdStr = item._id.toString();
    const itemTrackData = itemTrackMap[itemIdStr];

    if (!itemTrackData) {
        console.warn(`No ItemTrack data found for itemId: ${itemIdStr}`);
    }

    return {
        ...item,
        currentStock: itemTrackData?.currentStock ?? 1, 
    };
  });

  return { enrichedItems };
};








// BMCR existing data
const bmcrDataExist = async (organizationId) => {
  const [brandExist, manufacturerExist, categoriesExist, rackExist ] = await Promise.all([
    BMCR.find({ type: 'brand', organizationId }, { brandName: 1, _id: 0 }),
    BMCR.find({ type: 'manufacturer', organizationId }, { manufacturerName: 1, _id: 0 }),
    BMCR.find({ type: 'category', organizationId }, { categoriesName: 1, _id: 0 }),
    BMCR.find({ type: 'rack', organizationId }, { rackName: 1, _id: 0 })
  ]);
  return { brandExist, manufacturerExist, categoriesExist, rackExist };
};

// Fetch Item existing data
const itemDataExist = async (organizationId, itemId) => {
  const [ organizationExists, itemTrackAll, allItem, item] = await Promise.all([
    Organization.findOne({ organizationId }, { organizationId: 1,timeZoneExp: 1, dateFormatExp: 1, dateSplit: 1}),
    ItemTrack.find({ itemId: { $in: [itemId] } }),
    Item.find({ organizationId },{ organizationId :0, itemImage: 0 } )
    .populate('salesAccountId', 'accountName') 
    .populate('purchaseAccountId', 'accountName')
    .populate('preferredVendorId', 'supplierDisplayName')  
    .lean(),
    Item.findById(itemId)
    .populate('salesAccountId', 'accountName') 
    .populate('purchaseAccountId', 'accountName')
    .populate('preferredVendorId', 'supplierDisplayName  mobile billingAddressStreet1 billingAddressStreet2 billingCity billingState billingCountry billingPinCode')
    .lean()
  ]);
  return { organizationExists, itemTrackAll, allItem, item };
};






// Add item
exports.addItem = async (req, res) => {
    console.log("Add Item:", req.body);
    try {
     const organizationId = req.user.organizationId;

      const cleanedData = cleanData(req.body);      
      
      const { salesAccountId, purchaseAccountId, itemName, sku, openingStock, taxRate } = cleanedData;

      //Data Exist Validation
      const { organizationExists, taxExists, settingsExist,  salesAccount, purchaseAccount } = await dataExist( organizationId, salesAccountId, purchaseAccountId );
      const { brandExist, manufacturerExist, categoriesExist, rackExist } = await bmcrDataExist(organizationId);
      const bmcr = { brandExist, manufacturerExist, categoriesExist, rackExist };
      
      if (!validateOrganizationTaxCurrency(organizationExists, taxExists, settingsExist, res)) return;     

      // Check for duplicate item name
      if (!settingsExist.itemDuplicateName && await isDuplicateItemName(itemName, organizationId, res)) return;
    
      // Check for duplicate SKU
      if (cleanedData.sku !== undefined && await isDuplicateSKU(sku, organizationId, res)) return;


      //Validate Inputs  
      if (!validateInputs(cleanedData, settingsExist, taxExists, organizationId, bmcr, salesAccount, purchaseAccount, res)) return;

      //Tax Type
      taxType( cleanedData, taxExists, taxRate );      
       
     
      const newItem = new Item({ ...cleanedData, organizationId });

      const savedItem = await newItem.save();

      const openingStockDate = moment.tz(settingsExist.openingStockDate, organizationExists.timeZoneExp).startOf("day"); 

      const closingStockDate = openingStockDate.clone().subtract(1, "day").toISOString();      

      const trackEntry = new ItemTrack({
        organizationId,
        operationId: savedItem._id,
        action: "Opening Stock", 
        itemId: savedItem._id,
        sellingPrice:savedItem.sellingPrice || 0 ,
        costPrice:savedItem.costPrice || 0 ,
        debitQuantity: openingStock || 0 ,
        createdDateTime:closingStockDate,
      });  
      await trackEntry.save();
      console.log( "Item Track Added", trackEntry );      
      
  
      res.status(201).json({ message: "New Item created successfully." });
      console.log( "New Item created successfully:", savedItem );
    } catch (error) {
      console.error("Error creating Item:", error);
      res.status(500).json({ message: "Internal server error." });
    }
};

// Get all items
exports.getAllItem = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    const { organizationExists, allItem } = await itemDataExist( organizationId, null );
    
    if (!organizationExists) return res.status(404).json({ message: "No Organization Found." });
    
    if (allItem) res.status(200).json(allItem);
    else return res.status(404).json("No Items found.");
    
  } catch (error) {
    console.error("Error fetching Items:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

//Get all item xs 
exports.getAllItemXS = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    const { organizationExists } = await itemDataExist( organizationId, null );
    
    if (!organizationExists) return res.status(404).json({ message: "No Organization Found." });

    const { enrichedItems  } = await xsItemDataExists(organizationId);

    if (enrichedItems ) {
      res.status(200).json(enrichedItems);
    } else {
      return res.status(404).json("No Items found.");
    }
  } catch (error) {
    console.error("Error fetching Items:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

//Get all item m
exports.getAllItemM = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;

    const { organizationExists } = await itemDataExist( organizationId, null );
    
    if (!organizationExists) return res.status(404).json({ message: "No Organization Found." });

    const { enrichedItems  } = await mItemDataExists(organizationId);        

    if ( enrichedItems ) {
      res.status(200).json(enrichedItems);            
    } else {
      return res.status(404).json("No Items found.");
    }
  } catch (error) {
    console.error("Error fetching Items:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};


// Get one item
exports.getAItem = async (req, res) => {  
  try {
    const { itemId } = req.params;
    const organizationId = req.user.organizationId;

    const { organizationExists, item } = await itemDataExist( organizationId, itemId );

    if (!organizationExists) return res.status(404).json({ message: "No Organization Found." });
          
      
    if (!item) {
      return res.status(404).json({ message: "Item not found." });
    }
      
      
      const transformedItems = {
        ...item,
        salesAccountId: item.salesAccountId?._id || undefined,
        salesAccountName: item.salesAccountId?.accountName || undefined,

        purchaseAccountId: item.purchaseAccountId?._id || undefined,
        purchaseAccountName: item.purchaseAccountId?.accountName || undefined,

        preferredVendorId: item.preferredVendorId?._id || undefined,
        preferredVendorName: item.preferredVendorId?.supplierDisplayName || undefined,
        preferredVendorMobile: item.preferredVendorId?.mobile || undefined,
        preferredVendorBillingAddressStreet1: item.preferredVendorId?.billingAddressStreet1 || undefined,
        preferredVendorBillingAddressStreet2: item.preferredVendorId?.billingAddressStreet2 || undefined,
        preferredVendorBillingCity: item.preferredVendorId?.billingCity || undefined,
        preferredVendorBillingState: item.preferredVendorId?.billingState || undefined,
        preferredVendorBillingCountry: item.preferredVendorId?.billingCountry || undefined,
        preferredVendorBillingPinCode: item.preferredVendorId?.billingPinCode || undefined,

      };

      res.status(200).json(transformedItems);
    } catch (error) {
      console.error("Error fetching Item:", error);
      res.status(500).json({ message: "Internal server error." });
    }
};


// Update Item
exports.updateItem = async (req, res) => {
  console.log("Edit item:", req.body); 
  try {    
    const organizationId = req.user.organizationId;
    const { itemId } = req.params;
    const cleanedData = cleanData(req.body);
    const { salesAccountId, purchaseAccountId, itemName, sku, taxRate } = cleanedData;

    const existingItem = await Item.findById(itemId);
    
    if (!existingItem) return res.status(404).json({ message: "Item not found" });
      

    //Data Exist Validation
    const { organizationExists, taxExists, settingsExist, salesAccount, purchaseAccount } = await dataExist( organizationId, salesAccountId, purchaseAccountId );
    const { brandExist, manufacturerExist, categoriesExist, rackExist } = await bmcrDataExist(organizationId);
    const bmcr = { brandExist, manufacturerExist, categoriesExist, rackExist };
    const { itemTrackAll  } = await itemDataExist( organizationId, itemId );
    
    if (!validateOrganizationTaxCurrency(organizationExists, taxExists, settingsExist, res)) return;     
    
    // Check for duplicate item name
    if (!settingsExist.itemDuplicateName && await isDuplicateItemNameExist( itemName, organizationId, itemId, res )) return;

    // Check for duplicate SKU
    if (cleanedData.sku !== undefined && await isDuplicateSKUExist( sku, organizationId, itemId, res )) return;

    //Validate Inputs  
    if (!validateInputs(cleanedData, settingsExist, taxExists, organizationId, bmcr,  salesAccount, purchaseAccount, res)) return;
   
     //Tax Type
    taxType( cleanedData, taxExists, taxRate );      

    // Update customer fields
    Object.assign( existingItem, cleanedData );
    const savedItem = await existingItem.save();

    await updateOpeningBalanceInItemTrack( itemTrackAll, cleanedData);
 
    if (!savedItem) {
      console.error("Item could not be saved.");
      return res.status(500).json({ message: "Failed to Update Item" });
    }      

    res.status(200).json({ message: "Item updated successfully", savedItem });
    console.log("Item updated successfully:", savedItem);
  } catch (error) {
    console.error("Error updating item:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Delete an item
exports.deleteItem = async (req, res) => {
  try {
      const organizationId = req.user.organizationId;
      const {itemId} = req.params;

      // Validate customerId
      if (!mongoose.Types.ObjectId.isValid(itemId) || itemId.length !== 24) {
          return res.status(400).json({ message: `Item ID: ${itemId}` });
      }

      // Fetch existing item
      const existingItem = await Item.findOne({ _id: itemId, organizationId });
      if (!existingItem) {
          console.log("Item not found with ID:", itemId);
          return res.status(404).json({ message: "Item not found!" });
      }

      const itemTrackCount = await ItemTrack.countDocuments({
        organizationId: existingItem.organizationId,
        itemId: existingItem._id,
      });
      if (itemTrackCount > 1) {
        console.log("Item cannot be deleted as it exists in ItemTrack");
        return res.status(400).json({ message: "Item cannot be deleted as it is referenced in ItemTrack!" });
      } 

      // If there is only one TrialBalance entry, delete it
      if (itemTrackCount === 1) {
        await ItemTrack.deleteOne({
            organizationId: existingItem.organizationId,
            itemId: existingItem._id,
        });
        console.log(`Deleted existing ItemTrack entry for itemId: ${existingItem._id}`);
      }
    
      // Delete the associated item
      const deletedItemTrackEntry = await ItemTrack.deleteOne();
      if (!deletedItemTrackEntry) {
          console.error("Failed to delete associated item!");
          return res.status(500).json({ message: "Failed to delete associated item!" });
      }

      // Delete the item
      const deletedItem = await existingItem.deleteOne();
      if (!deletedItem) {
          console.error("Failed to delete item!");
          return res.status(500).json({ message: "Failed to delete item!" });
      }

      res.status(200).json({ message: "Item deleted successfully!" });
      console.log("Item deleted successfully with ID:", itemId);
  } catch (error) {
    console.error("Error deleting item:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};








// Function to update the opening balance in item tracking
const updateOpeningBalanceInItemTrack = async ( itemTrackAll, cleanedData) => {
 
  itemTrackAll.forEach(itemTrack => {
    if (itemTrack.action === "Opening Stock") {
      itemTrack.sellingPrice = cleanedData.sellingPrice || 0 ;
      itemTrack.costPrice = cleanedData.costPrice || 0 ;
      itemTrack.debitQuantity = cleanedData.openingStock || 0 ;
    }    
  });

  console.log("Item track's CurrentStock updated based on the new opening stock.");
  

  // If you need to persist these changes, save each itemTrack to the database
  for (const itemTrack of itemTrackAll) {
    try {
      await itemTrack.save();
    } catch (error) {
      console.error("Error saving itemTrack:", error.message);
    }
  }
};







// Check for duplicate item name - ADD
const isDuplicateItemName = async (itemName, organizationId, res) => {
  const existingItemName = await Item.findOne({ itemName, organizationId });
  if (existingItemName) {
      console.error("Item with this name already exists.");
      res.status(400).json({ message: "Item with this name already exists" });
      return true;
  }
  return false;
};

// Check for duplicate SKU - ADD
const isDuplicateSKU = async (sku, organizationId, res) => {
  const existingItem = await Item.findOne({ sku, organizationId });
  if (existingItem) {
      console.error("Item with this SKU already exists.");
      res.status(400).json({ message: "Item with this SKU already exists." });
      return true;
  }
  return false;
};

// Check for duplicate item name - EDIT
const isDuplicateItemNameExist = async (itemName, organizationId, itemId, res) => { 
  const existingItemName = await Item.findOne({
    itemName,
    organizationId,
    _id: { $ne: itemId }
  });
  
  if (existingItemName) {
      console.error("Item with this name already exists.");
      res.status(400).json({ message: "Item with this name already exists" });
      return true;
  }
  
  return false;
};

// Check for duplicate SKU - EDIT
const isDuplicateSKUExist = async (sku, organizationId, itemId, res) => {
  const existingItem = await Item.findOne({ sku, organizationId,  _id: { $ne: itemId }  });
  if (existingItem) {
      console.error("Item with this SKU already exists.");
      res.status(400).json({ message: "Item with this SKU already exists." });
      return true;
  }
  return false;
};




// Validate Organization Tax Currency
function validateOrganizationTaxCurrency(organizationExists, taxExists, settingsExist, res) {
  if (!organizationExists) {
    res.status(404).json({ message: "Organization not found" });
    return false;
  }
  if (!taxExists) {
    res.status(404).json({ message: "Tax not found" });
    return false;
  }
  if (!settingsExist) {
    res.status(404).json({ message: "Settings not found" });
    return false;
  }
  return true;
}


function taxType( cleanedData, taxExists, taxRate ) {

  if (taxExists.taxType === 'GST') {
    taxExists.gstTaxRate.forEach((tax) => {
      if (tax.taxName === taxRate) {
        cleanedData.igst = tax.igst;
        cleanedData.cgst = tax.cgst; 
        cleanedData.sgst = tax.sgst;           
      }
    });
  }

  // Check if taxType is VAT
  if (taxExists.taxType === 'VAT') {
    taxExists.vatTaxRate.forEach((tax) => {
      if (tax.taxName === taxRate) {
        cleanedData.vat = tax.vat; 
      }
    });
  }
  
}






















//Validate inputs
function validateInputs(data, settingsExist, taxExists, organizationId, bmcr,  salesAccount, purchaseAccount, res) {
   const validationErrors = validateItemData( data, settingsExist, taxExists, organizationId, bmcr,  salesAccount, purchaseAccount );

  if (validationErrors.length > 0) {
    res.status(400).json({ message: validationErrors.join(", ") });
    return false;
  }
  return true;
}



//Validate Data
function validateItemData( data, settingsExist, taxExists, organizationId, bmcr,  salesAccount, purchaseAccount ) {  
  
  const errors = [];

  //Basic Info

  //OtherDetails
  validateReqFields( data, errors );
  validateAccountStructure( data, salesAccount, purchaseAccount, errors);
  validateItemType(data.itemType, errors);
  validateTaxPreference(data.taxPreference, errors);
  validateHsnSac(data.hsnCode, data.sac, settingsExist, errors);
  validateType(data.type, errors);    //sewnex variable
  validateBMCRFields( data.brand, data.manufacturer, data.categories, data.rack, bmcr, errors);


  validateAlphanumericFields(['mpn','isbn'], data, errors);
  validateIntegerFields(['upc','ean'], data, errors);
  validateFloatFields(['length', 'width', 'height', 'weight', 'sellingPrice', 'saleMrp', 'costPrice', 'openingStock', 'openingStockRatePerUnit', 'reorderPoint'], data, errors);
  //validateAlphabetsFields([''], data, errors);

  //Tax Details
  validateTaxType(data.taxRate, data.taxPreference, taxExists, errors);

  return errors;
}


function validateHsnSac(hsnCode, sac, settingsExist, errors) {
  if (settingsExist.hsnSac === true) {
    const hsnDigits = settingsExist.hsnDigits;

    if (hsnDigits === "4") {
      if (hsnCode && hsnCode.length > 4) {
        errors.push("HSN Code must not exceed 4 digits.");
      }
      if (sac && sac.length > 4) {
        errors.push("SAC Code must not exceed 4 digits.");
      }
    } else if (hsnDigits === "6") {
      if (hsnCode && hsnCode.length > 6) {
        errors.push("HSN Code must not exceed 6 digits.");
      }
      if (sac && sac.length > 6) {
        errors.push("SAC Code must not exceed 6 digits.");
      }
    }
  }
}




// Field validation utility
function validateField(condition, errorMsg, errors) {
    if (condition) {
      console.log(errorMsg);      
      errors.push(errorMsg)};
}

//Valid Item Type
function validateItemType(itemType, errors) {
  validateField(itemType && !validItemTypes.includes(itemType),
    "Invalid Item type: " + itemType, errors);
}

//Valid Item Type
function validateTaxPreference(taxPreference, errors) {
  validateField(taxPreference && !validTaxPreference.includes(taxPreference),
    "Invalid Tax Preference: " + taxPreference, errors);
}

// Validate Type (sewnex variable)
function validateType(type, errors) {
  validateField(
    type && !validType.includes(type),
    "Invalid Expense Type: " + type, errors );
} 

//Valid Req Fields
function validateReqFields( data, errors ) {
  validateField(typeof data.itemName === 'undefined',"Item Name required", errors);
  
  validateField(typeof data.taxPreference === 'undefined',"Tax Preference required", errors);
  validateField(data.taxPreference ==='Taxable' && typeof data.taxRate === 'undefined',"Tax Rate required", errors);
  validateField(data.taxPreference ==='Non-taxable' && typeof data.taxExemptReason === 'undefined',"Tax Exemption Reason required", errors);
  validateField(data.taxPreference ==='Non-taxable' && typeof data.taxRate !== 'undefined',"Invalid Tax Preference", errors);
  
  validateField(typeof data.sellingPrice !== 'undefined' && typeof data.salesAccountId === 'undefined',"Sales Account required", errors);
  validateField(typeof data.costPrice !== 'undefined' && typeof data.purchaseAccountId === 'undefined',"Purchase Account required", errors);

  validateField(typeof data.openingStock !== 'undefined' && typeof data.costPrice === 'undefined',"Cost Price required", errors);

  validateField(data.internalManufacturingItem === true && typeof data.chooseService === 'undefined', "Please select service!", errors);
}

// Validation function for account structure
function validateAccountStructure( data, salesAccount, purchaseAccount, errors ) {
  if(data.salesAccountId) {
    validateField( salesAccount.accountGroup !== "Asset" || salesAccount.accountHead !== "Income" || salesAccount.accountSubhead !== "Sales" , "Invalid Sales Account.", errors);
  }
  if(data.purchaseAccountId) {
    validateField( purchaseAccount.accountGroup !== "Liability" || purchaseAccount.accountHead !== "Expenses" ||  (purchaseAccount.accountSubhead !== "Expense" && purchaseAccount.accountSubhead !== "Cost of Goods Sold") , "Invalid Purchase Account.", errors);
  }
}


//Valid BMCR field
function validateBMCRFields(brand, manufacturer, categories, rack, bmcr, errors) {
    const validBrandNames = bmcr.brandExist.map(item => item.brandName);
    validateField(brand && !validBrandNames.includes(brand), "Invalid Brand: " + brand+" Choose a valid brand", errors);

    const validManufacturerNames = bmcr.manufacturerExist.map(item => item.manufacturerName);
    validateField(manufacturer && !validManufacturerNames.includes(manufacturer), "Invalid Manufacturer: " + manufacturer+" Choose a valid manufacturer", errors);

    const validCategoryNames = bmcr.categoriesExist.map(item => item.categoriesName);
    validateField(categories && !validCategoryNames.includes(categories), "Invalid Category: " + categories+" Choose a valid category", errors);

    const validRackNames = bmcr.rackExist.map(item => item.rackName);
    validateField(rack && !validRackNames.includes(rack), "Invalid Rack: "+ rack +" Choose a valid rack", errors);  
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


//Validate Tax Type
function validateTaxType( taxRate, taxPreference, taxExists, errors ) {
  const taxType = taxExists.taxType;
  let taxFound = false;


  // Check if taxType is GST
  if (taxType === 'GST' && taxPreference =='Taxable' ) {
    taxExists.gstTaxRate.forEach((tax) => {
      
      if (tax.taxName === taxRate) {
        taxFound = true;
        console.log(`Matching GST tax found: ${tax.taxName} with rate: ${tax.taxRate}`);
      }
    });
  }
  
  // Check if taxType is VAT
  if (taxType === 'VAT' && taxPreference =='Taxable') {
    taxExists.vatTaxRate.forEach((tax) => {
      if (tax.taxName === taxRate) {
        taxFound = true;
        console.log(`Matching VAT tax found: ${tax.taxName} with rate: ${tax.taxRate}`);
      }
    });
  }

  // If no matching tax rate found, add an error
  if (!taxFound  && taxPreference =='Taxable' ) {
    errors.push(`No matching ${taxType} Tax group found `);
  }  
  
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




const validItemTypes = [ "goods", "service" ];
const validTaxPreference = [ "Non-taxable", "Taxable" ]; 
const validType = [ "Fabric", "Raw Material", "Ready Made" ];   //sewnex variable




