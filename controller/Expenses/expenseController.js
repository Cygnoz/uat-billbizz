const Organization = require("../../database/model/organization");
const Expense = require("../../database/model/expense");
const Category = require("../../database/model/expenseCategory");
const Account = require("../../database/model/account")
const TrialBalance = require("../../database/model/trialBalance");
const Supplier = require('../../database/model/supplier');
const Tax = require('../../database/model/tax');  
const Prefix = require("../../database/model/prefix");
const DefAcc  = require("../../database/model/defaultAccount");
const mongoose = require('mongoose');
// const { ObjectId } = require('mongodb');

const moment = require("moment-timezone");

const { cleanData } = require("../../services/cleanData");
const { singleCustomDateTime, multiCustomDateTime } = require("../../services/timeConverter");



const dataExist = async (organizationId, supplierId) => {
    const [organizationExists, categoryExists, accountExist, supplierExist, existingPrefix, defaultAccount] = await Promise.all([
      Organization.findOne({ organizationId }, { organizationId: 1, organizationCountry: 1, state: 1, timeZoneExp: 1 }),
      Category.find({ organizationId }),
      Account.find({ organizationId }),
      Supplier.findOne({ organizationId , _id:supplierId}, { _id: 1, supplierDisplayName: 1, taxType: 1, sourceOfSupply: 1, gstin_uin: 1, gstTreatment: 1 }),
      Prefix.findOne({ organizationId }),
      DefAcc.findOne({ organizationId },{ inputCgst: 1, inputSgst: 1, inputIgst: 1 , inputVat: 1 }),
    ]);
    
    return { organizationExists, categoryExists, accountExist, supplierExist, existingPrefix, defaultAccount };
  };


  // Fetch Acc existing data
  const accDataExists = async ( organizationId, expenseAccountId, paidThroughAccountId ) => {
    const [ expenseAcc, paidThroughAcc ] = await Promise.all([
      Account.findOne({ organizationId , _id: expenseAccountId, accountGroup: "Liability" }, { _id:1, accountName: 1 }),
      Account.findOne({ organizationId , _id: paidThroughAccountId, accountSubhead: { $in: ["Cash", "Bank"] } }, { _id:1, accountName: 1 }),
    ]);
    return { expenseAcc, paidThroughAcc };
  };


  const expenseDataExist = async ( organizationId, expenseId ) => {    
    const [organizationExists, allExpense, expense, expenseJournal] = await Promise.all([
      Organization.findOne({ organizationId }, { organizationId: 1, timeZoneExp: 1, dateFormatExp: 1, dateSplit: 1, organizationCountry: 1}).lean(),
      Expense.find({ organizationId })
      .populate('supplierId', 'supplierDisplayName')    
      .populate('paidThroughAccountId', 'accountName') 
      .populate('expense.expenseAccountId', 'accountName')
      .lean(),
      Expense.findOne({ organizationId , _id: expenseId }) 
      .populate('supplierId', 'supplierDisplayName') 
      .populate('paidThroughAccountId', 'accountName') 
      .populate('expense.expenseAccountId', 'accountName')   
      .lean(),
      TrialBalance.find({ organizationId: organizationId, operationId : expenseId })
      .populate('accountId', 'accountName')    
      .lean(),
    ]);
    return { organizationExists, allExpense, expense, expenseJournal };
  };





// Expense
//add expense
exports.addExpense = async (req, res) => {
  console.log("Add Expense:", req.body);

  try {
    const { organizationId, id: userId, userName } = req.user;

    //Clean Data
    const cleanedData = cleanData(req.body);

    cleanedData.expense = cleanedData.expense
    ?.map(data => cleanData(data))
    .filter(info => info.expenseAccountId !== undefined && info.expenseAccountId !== '') || []; 

    const { supplierId, paidThroughAccountId, expense } = cleanedData;
    const expenseIds = expense.map(e => e.expenseAccountId);

    //Validate Supplier
    if (supplierId && (!mongoose.Types.ObjectId.isValid(supplierId) || supplierId.length !== 24)) {
      return res.status(400).json({ message: `Invalid supplier ID: ${supplierId}` });
    }

    if ((!mongoose.Types.ObjectId.isValid(paidThroughAccountId) || paidThroughAccountId.length !== 24) && cleanedData.paidThroughAccountId !== undefined ) {
      return res.status(400).json({ message: `Select paid through account` });
    }

    // Validate expenseIds
    const invalidExpenseIds = expenseIds.filter(expenseAccountId => !mongoose.Types.ObjectId.isValid(expenseAccountId) || expenseAccountId.length !== 24);
    if (invalidExpenseIds.length > 0) {
      return res.status(400).json({ message: `Invalid expense IDs: ${invalidExpenseIds.join(', ')}` });
    } 

    // Check for duplicate expenseIds
    const uniqueExpenseIds = new Set(expenseIds);
    if (uniqueExpenseIds.size !== expenseIds.length) {
      return res.status(400).json({ message: "Duplicate Expense found" });
    }

    // Validate organizationId
    const { organizationExists, accountExist, supplierExist, existingPrefix, defaultAccount } = await dataExist(organizationId, supplierId);

    const { paidThroughAcc } = await accDataExists( organizationId, null, cleanedData.paidThroughAccountId );

    // Extract all account IDs from accountExist
    const accountIds = accountExist.map(account => account._id.toString());
      
      // Check if each expense's expenseAccountId exists in allAccounts
    if(!accountIds.includes(cleanedData))
      for (let expenseItem of cleanedData.expense) {
        if (!accountIds.includes(expenseItem.expenseAccountId)) {
          return res.status(404).json({ message: `Account with ID ${expenseItem.expenseAccountId} not found` });
        }
      }
    
    //Data Exist Validation
    if (!validateOrganizationSupplierAccount( organizationExists, accountExist, supplierExist, supplierId, existingPrefix, defaultAccount, res )) return;
    
    if (!validateInputs(cleanedData, organizationExists, defaultAccount, paidThroughAcc, res)) return;
    
    //Tax Mode
    taxMode(cleanedData);
    
    //Default Account
    const { defAcc, error } = await defaultAccounting( cleanedData, defaultAccount, organizationExists );
    if (error) { 
      res.status(400).json({ message: error }); 
      return false; 
    }
    
    // Calculate Expense 
    if (!calculateExpense( cleanedData, res )) return;
    
    //Prefix
    await expensePrefix(cleanedData, existingPrefix );

    cleanedData.createdDateTime = moment.tz(cleanedData.expenseDate, "YYYY-MM-DDTHH:mm:ss.SSS[Z]", organizationExists.timeZoneExp).toISOString();           

    // Create a new expense
    const savedExpense = await createNewExpense(cleanedData, organizationId, userId, userName);
      
    //Journal
    await journal(savedExpense, defAcc, paidThroughAcc);

    res.status(201).json({ message: "Expense created successfully." });
  } catch (error) {
      console.error("Error adding expense:", error);
      res.status(400).json({ error: error.message });
  }
};

//get all expense
exports.getAllExpense = async (req, res) => {
    try {
      const organizationId = req.user.organizationId;
  
      const { organizationExists, allExpense } = await expenseDataExist(organizationId, null);
  
      if (!organizationExists) {
        return res.status(404).json({ message: "Organization not found" });
      }
  
      if (!allExpense) {
        return res.status(404).json({ message: "No Expense found" });
      }
      
      const transformedExpense = allExpense.map(data => {
         
        return {
          ...data,
          supplierId: data.supplierId ? data.supplierId._id : undefined,  
          supplierDisplayName: data.supplierId ? data.supplierId.supplierDisplayName : undefined, 
          paidThroughAccountId: data.paidThroughAccountId,
          paidThroughAccountName: data.paidThroughAccountId.accountName,
          expense: data.expense.map(exp => ({
            ...exp,
            expenseAccountId: exp.expenseAccountId._id,
            expenseAccountName: exp.expenseAccountId.accountName,
          }))
        };});
        
        
      const formattedObjects = multiCustomDateTime(transformedExpense, organizationExists.dateFormatExp, organizationExists.timeZoneExp, organizationExists.dateSplit );    
  
      res.status(200).json(formattedObjects);
    } catch (error) {
      console.error("Error fetching Expense:", error);
      res.status(500).json({ message: "Internal server error." });
    }
  };

//get a expense
exports.getOneExpense = async (req, res) => {
    try {
      const organizationId = req.user.organizationId;
      const expenseId = req.params.expenseId;

      if ( !expenseId || expenseId.length !== 24 ) return res.status(404).json({ message: "No expense found" });
  
      const { organizationExists, expense } = await expenseDataExist( organizationId, expenseId );

      if (!organizationExists) return res.status(404).json({ message: "Organization not found" });

      if (!expense) return res.status(404).json({ message: "No expense found" });
      
      const transformedExpense = {
        ...expense,
        supplierId: expense.supplierId ? expense.supplierId._id : undefined,  
        supplierDisplayName: expense.supplierId ? expense.supplierId.supplierDisplayName : undefined,
        paidThroughAccountId: expense.paidThroughAccountId._id,
        paidThroughAccountName: expense.paidThroughAccountId.accountName,
        expense: expense.expense.map(exp => ({
          ...exp,
          expenseAccountId: exp.expenseAccountId._id,
          expenseAccountName: exp.expenseAccountId.accountName,
        }))
      };
      
      const formattedObjects = singleCustomDateTime(transformedExpense, organizationExists.dateFormatExp, organizationExists.timeZoneExp, organizationExists.dateSplit );    

      res.status(200).json(formattedObjects);
    } catch (error) {
      console.error("Error fetching expense:", error);
      res.status(500).json({ message: "Internal server error." });
    }
  };







// Expense Category
//add category
exports.addCategory = async (req, res) => {
  console.log("req:",req.body);
    try {
      const { organizationId, id: userId, userName } = req.user;
        
        const cleanBody = removeSpaces(req.body)

        const {  expenseCategory, description } = cleanBody;

        const { organizationExists, categoryExists } = await dataExist(organizationId);

        // Check if organization exists
        if (!organizationExists) {
            return res.status(404).json({ message: "Organization not found" });
        }

        // Check if any category in categoryExists has the same expenseCategory
        const duplicateCategory = categoryExists.some(
            (category) => category.expenseCategory.toLowerCase().replace(/\s+/g, "") === expenseCategory.toLowerCase().replace(/\s+/g, "")
        );

        if (duplicateCategory) {
            return res.status(409).json({
                message: "Category  already exists ",
            });
        }

        // Create and save new category
        const newCategory = new Category({ organizationId, expenseCategory, description, userId, userName });
        await newCategory.save();

        res.status(201).json({ message: "Category created successfully", newCategory});
    } catch (error) {
        console.error("Error adding category:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};


exports.getAllCategory = async (req, res) => {
    try {
        const  organizationId  = req.user.organizationId;

        const { organizationExists, categoryExists } = await dataExist(organizationId);

        if (!organizationExists) {
            return res.status(404).json({
                message: "Organization not found",
            });
        }

        if (!categoryExists.length) {
            return res.status(404).json({
                message: "No category found",
            });
        }

        // Map over all categories to remove the organizationId from each object
        const AllCategories = categoryExists.map((history) => {
            const { organizationId, ...rest } = history.toObject(); // Convert to plain object and omit organizationId
            return rest;
        });

        res.status(200).json(AllCategories);
    } catch (error) {
        console.error("Error fetching category:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};

//get a category
exports.getACategory = async (req, res) => {
    try {
      const organizationId = req.user.organizationId;
      const categoryId = req.params.categoryId;

      const {organizationExists} = await dataExist(organizationId);
  
      if (!organizationExists) {
        return res.status(404).json({
          message: "Organization not found",
        });
      }
  
      // Find the Customer by   supplierId and organizationId
      const category = await Category.findOne({
        _id: categoryId,
        organizationId: organizationId,
      });
  
      if (!category) {
        return res.status(404).json({
          message: "category not found",
        });
      }
      
      category.organizationId = undefined;
      
      res.status(200).json(category);
    } catch (error) {
      console.error("Error fetching category:", error);
      res.status(500).json({ message: "Internal server error." });
    }
  };

//update category
exports.updateCategory = async (req, res) => {
    
    try {
        const organizationId = req.user.organizationId;
        const categoryId = req.params.categoryId;

        const cleanBody = removeSpaces(req.body)

        const {
            expenseCategory,
            description,
        } = cleanBody;

        // Validate organizationId
        const { organizationExists } = await dataExist(organizationId);

        if (!organizationExists) {
            return res.status(404).json({
            message: "Organization not found",
            });
        }

        // Check if supplierEmail already exists for another supplier
        const existingCategory = await Category.findOne({ expenseCategory });
        if (existingCategory && existingCategory._id.toString().trim() !== categoryId.trim()) {
            return res.status(400).json({ message: "expenseCategory already exists for another category" });
        }

        const updatedCategory = await Category.findByIdAndUpdate(
            categoryId,
            {
                organizationId,
                expenseCategory,
                description,
            },
            { new: true, runValidators: true }
        );

        if (!updatedCategory) {
            console.log("Category not found with ID:", categoryId);
            return res.status(404).json({ message: "Category not found" });
        }

        updatedCategory.organizationId = undefined;

        res.status(200).json({ message: "Category updated successfully", updatedCategory});
        console.log("Category updated successfully:", updatedCategory);
    } catch (error) {
        console.error("Error updating category:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

//delete category
exports.deleteCategory = async (req, res) => {
    console.log("Delete category:", req.body);
    try {
      const organizationId = req.user.organizationId;
      const categoryId = req.params.categoryId;

        // Validate organizationId
        const organizationExists = await Organization.findOne({
            organizationId: organizationId,
        });
        if (!organizationExists) {
            return res.status(404).json({
            message: "Organization not found",
            });
        }

        const category = await Category.findById(categoryId);

        if (!category) {
            return res.status(404).json({ message: "Category not found." });
        }

        await Category.findByIdAndDelete(categoryId);
        
        res.status(200).json({ message: "Category deleted successfully." });
        console.log("Category deleted successfully:", categoryId);
    } catch (error) {
        console.error("Error deleting category:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};


// Get Expense Journal
exports.expenseJournal = async (req, res) => {
  try {
      const organizationId = req.user.organizationId;
      const { expenseId } = req.params;

      const { expenseJournal } = await expenseDataExist( organizationId, expenseId );      

      if (!expenseJournal) {
          return res.status(404).json({
              message: "No Journal found for the Expense.",
          });
      }

      const transformedJournal = expenseJournal.map(exp => {
        return {
            ...exp,
            accountId: exp.accountId?._id,  
            accountName: exp.accountId?.accountName,  
        };
    });

    console.log("Transformed Journal:", transformedJournal);
      
      res.status(200).json(transformedJournal);
  } catch (error) {
      console.error("Error fetching journal:", error);
      res.status(500).json({ message: "Internal server error." });
  }
};


function removeSpaces(body) {
    const cleanedBody = {};

    for (const key in body) {
        if (typeof body[key] === 'string') {
            // Trim the string and normalize spaces for string values
            cleanedBody[key] = body[key].trim();
        } else {
            // Copy non-string values directly
            cleanedBody[key] = body[key];
        }
    }

    return cleanedBody;
}




// Get last expense prefix
exports.getLastExpensePrefix = async (req, res) => {
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
      const lastPrefix = series.expense + series.expenseNum;

      lastPrefix.organizationId = undefined;

      res.status(200).json(lastPrefix);
  } catch (error) {
      console.error("Error fetching accounts:", error);
      res.status(500).json({ message: "Internal server error." });
  }
};

// Expense Prefix
function expensePrefix( cleanData, existingPrefix ) {
  const activeSeries = existingPrefix.series.find(series => series.status === true);
  if (!activeSeries) {
      return res.status(404).json({ message: "No active series found for the organization." });
  }
  cleanData.expenseNumber = `${activeSeries.expense}${activeSeries.expenseNum}`;

  activeSeries.expenseNum += 1;

  existingPrefix.save() 
}


  

  // Create New Expense
  function createNewExpense(data, organizationId, userId, userName) {
    const newExpense = new Expense({ ...data, organizationId, userId, userName });
    return newExpense.save();
  }



  // Validate Organization Supplier Account
  function validateOrganizationSupplierAccount( organizationExists, accountExist, supplierExist, supplierId, existingPrefix, defaultAccount, res ) {
    if (!organizationExists) {
      res.status(404).json({ message: "Organization not found" });
      return false;
    }
    if (!accountExist) {
      res.status(404).json({ message: "Accounts not found" });
      return false;
    }
    // Check supplierExist only if supplierId is not empty
    if (supplierId && supplierId.trim() !== "" && !supplierExist) {
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


  // Tax Mode
  function taxMode( cleanedData ) {
    if (!cleanedData.sourceOfSupply || !cleanedData.destinationOfSupply) {
      cleanedData.taxMode = 'None'; // Handle invalid or missing data
    } else if (cleanedData.sourceOfSupply === cleanedData.destinationOfSupply) {
      cleanedData.taxMode = 'Intra';
    } else {
      cleanedData.taxMode = 'Inter';
    }
  }






  //Default Account
  async function defaultAccounting(data, defaultAccount, organizationExists) {
    // 1. Fetch required accounts
    const accounts = await accDataExists(
      organizationExists.organizationId, 
      data.expenseAccountId, 
      data.paidThroughAccountId
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
    ];
  
    const missingAccounts = accountChecks
      .filter(({ condition, account }) => condition && !account)
      .map(({ message }) => `${message} not found`);
  
    return missingAccounts.length ? missingAccounts.join(". ") : null;
  }
  
  function assignAccountReferences(data, defaultAccount, accounts) {
    if (data.expenseAccountId) {
      defaultAccount.expenseAccountId = accounts.expenseAcc?._id;
    }
  }







  
  function calculateExpense(cleanedData, res) {
    const errors = [];

    let subTotal = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    let vat = 0;
    let grandTotal = 0;
    let distance = parseFloat(cleanedData.distance) || 0;
    let ratePerKm = parseFloat(cleanedData.ratePerKm) || 0;

    // Utility function to round values to two decimal places
    const roundToTwoDecimals = (value) => Number(value.toFixed(2));

    cleanedData.expense.forEach((data, index) => {    

      let total = parseFloat(data.total) || 0;
      let calculatedCgstAmount = 0;
      let calculatedSgstAmount = 0;
      let calculatedIgstAmount = 0;
      let calculatedVatAmount = 0;
      let amount = parseFloat(data.amount) || 0;
      let taxMode = cleanedData.taxMode;
      console.log("...taxMode...",taxMode);

      // subTotal += total;

      const gstTreatment = (cleanedData.gstTreatment !== "Registered Business - Composition") || (cleanedData.gstTreatment !== "Unregistered Business") || (cleanedData.gstTreatment !== "Overseas") || (cleanedData.gstTreatment !== "Consumer");
      const taxGroup = data.taxGroup !== "Non-Taxable";
      const isMileage = ((distance > 0) || (distance === "undefined")) && ((ratePerKm > 0) || (ratePerKm === "undefined"));

      // Handle tax calculation only for taxable expense
      if (gstTreatment && taxGroup && !isMileage) {
        if (cleanedData.amountIs === "Tax Exclusive") {

          if (taxMode === 'Intra') {
            calculatedCgstAmount = roundToTwoDecimals((data.cgst / 100) * amount);
            calculatedSgstAmount = roundToTwoDecimals((data.sgst / 100) * amount);
          } else if (taxMode === 'Inter') {
            calculatedIgstAmount = roundToTwoDecimals((data.igst / 100) * amount);
          } else {
            calculatedVatAmount = roundToTwoDecimals((data.vat / 100) * amount);
          }

        } else if (cleanedData.amountIs === "Tax Inclusive") {

          if (taxMode === 'Intra') {
            const tt = roundToTwoDecimals((amount / (100 + data.igst)) * 100); 
            calculatedCgstAmount = roundToTwoDecimals((data.cgst / 100) * tt);
            calculatedSgstAmount = roundToTwoDecimals((data.sgst / 100) * tt);

            let difference = 0;

            const amt = roundToTwoDecimals(tt + calculatedCgstAmount + calculatedSgstAmount);
            if ( amt < amount ) {
              difference = roundToTwoDecimals(amount - amt);
              total = roundToTwoDecimals(difference + tt);
            } else if ( amt > amount ) {
              difference = roundToTwoDecimals(amt - amount);
              total = roundToTwoDecimals(tt - difference);
            } else {
              total = tt;
            }

            console.log(`Row 123..................... ${index + 1}:`);
            console.log("tt",tt);
            console.log("amount",amount);
            console.log("amt",amt);
            console.log("difference",difference);
            console.log("total",total);

          } else if (taxMode === 'Inter') {
            const tt = roundToTwoDecimals((amount / (100 + data.igst)) * 100);
            calculatedIgstAmount = roundToTwoDecimals((data.igst / 100) * tt);

            const amt = tt + calculatedCgstAmount + calculatedSgstAmount;
            if ( amt > amount ) {
              const difference = amount - amt;
              total = difference + amt;
            } else if ( amount < amt ) {
              const difference = amt - amount;
              total = amt - difference;
            } else {
              total = tt;
            }

          } else {
            const tt = roundToTwoDecimals((amount / (100 + data.vat)) * 100);
            calculatedVatAmount = roundToTwoDecimals((data.vat / 100) * tt);

            const amt = tt + calculatedCgstAmount + calculatedSgstAmount;
            if ( amt > amount ) {
              const difference = amount - amt;
              total = difference + amt;
            } else if ( amount < amt ) {
              const difference = amt - amount;
              total = amt - difference;
            } else {
              total = tt;
            }
          }

        }

        console.log(`Row..................... ${index + 1}:`);
          console.log("calculatedTotal",total);
          console.log("calculatedCgstAmount",calculatedCgstAmount);
          console.log("calculatedSgstAmount",calculatedSgstAmount);
          console.log("calculatedIgstAmount",calculatedIgstAmount);
          console.log("calculatedVatAmount",calculatedVatAmount);
  
          checkAmount(total, data.total, 'Total', errors);
          checkAmount(calculatedCgstAmount, data.cgstAmount, 'CGST', errors);
          checkAmount(calculatedSgstAmount, data.sgstAmount, 'SGST', errors);
          checkAmount(calculatedIgstAmount, data.igstAmount, 'IGST', errors);
          checkAmount(calculatedVatAmount, data.vatAmount, 'VAT', errors);
          
          cgst = roundToTwoDecimals(cgst + calculatedCgstAmount);
          sgst = roundToTwoDecimals(sgst + calculatedSgstAmount);
          igst = roundToTwoDecimals(igst + calculatedIgstAmount);
          vat = roundToTwoDecimals(vat + calculatedVatAmount);
  
          console.log("cgst",cgst);
          console.log("sgst",sgst);
          console.log("igst",igst);
          console.log("vat",vat);

          subTotal += total;

          grandTotal = subTotal + (cgst + sgst + igst + vat);

        } else {
        console.log('Skipping Tax for Non-Taxable expense');

        subTotal += total;

        if (isMileage) {
          amount = roundToTwoDecimals(distance * ratePerKm);
          checkAmount(distance, cleanedData.distance, 'Distance',errors);
          checkAmount(ratePerKm, cleanedData.ratePerKm, 'Rate Per Km',errors);
          checkAmount(amount, data.amount, 'Amount',errors);
          checkAmount(total, data.total, 'Total',errors);

          console.log("calculatedTotal",total);
          console.log("distance",distance);
          console.log("ratePerKm",ratePerKm);
          console.log("amount",amount);

          grandTotal = subTotal;
        } else {
          grandTotal = subTotal;
        }
      }
    });

    checkAmount(cgst, cleanedData.cgst, 'Final CGST',errors);
    checkAmount(sgst, cleanedData.sgst, 'Final SGST',errors);
    checkAmount(igst, cleanedData.igst, 'Final IGST',errors);
    checkAmount(vat, cleanedData.vat, 'Final VAT',errors);

    console.log(`subTotal: ${subTotal} , Provided ${cleanedData.subTotal}`);
    console.log(`Grand Total: ${grandTotal} , Provided ${cleanedData.grandTotal}`);
  
    // Round the totals for comparison
    const roundedSubTotal = roundToTwoDecimals(subTotal); 
    const roundedGrandTotalAmount = roundToTwoDecimals(grandTotal);
  
    console.log(`Final Sub Total: ${roundedSubTotal} , Provided ${cleanedData.subTotal}` );
    console.log(`Final Total Amount: ${roundedGrandTotalAmount} , Provided ${cleanedData.grandTotal}` );
  
    validateAmount(roundedSubTotal, cleanedData.subTotal, 'SubTotal', errors);
    validateAmount(roundedGrandTotalAmount, cleanedData.grandTotal, 'Grand Total', errors);
  
    if (errors.length > 0) {
      res.status(400).json({ message: errors.join(", ") });
      return false;
    }
  
    return true;

  }







  //Mismatch Check
  function checkAmount(calculatedAmount, providedAmount, taxMode, errors) {
    const roundToTwoDecimals = (value) => Number(value.toFixed(2)); // Round to two decimal places
    const roundedAmount = roundToTwoDecimals(calculatedAmount);
    console.log(`Calculated ${taxMode}: ${roundedAmount}, Provided data: ${providedAmount}`);
  
    if (Math.abs(roundedAmount - providedAmount) > 0) {
      const errorMessage = `Mismatch in ${taxMode}: Calculated ${calculatedAmount}, Provided ${providedAmount}`;
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
  function validateInputs(data, organizationExists, defaultAccount, paidThroughAcc, res) {
    const validationErrors = validateExpenseData(data, organizationExists, defaultAccount, paidThroughAcc);
  
    if (validationErrors.length > 0) {
      res.status(400).json({ message: validationErrors.join(", ") });
      return false;
    }
    return true;
  }



  //Validate Data
  function validateExpenseData(data, organizationExists, defaultAccount, paidThroughAcc) {
    const errors = [];

    //Basic Info
    validateReqFields( data, errors);
    validateFloatFields(['distance', 'ratePerKm'], data, errors);
    // validateIntegerFields(['distance', 'ratePerKm'], data, errors);
    //validateAlphabetsFields(['department', 'designation'], data, errors);

    validateExpenseType(data.expenseType, errors);
    validateAmountIs(data.amountIs, errors)
    validateSourceOfSupply(data.sourceOfSupply, organizationExists, errors);
    validateDestinationOfSupply(data.destinationOfSupply, organizationExists, errors);
    validateGSTorVAT(data, errors);
   
    return errors;
  }

  

  // Field validation utility
  function validateField(condition, errorMsg, errors) {
    if (condition) errors.push(errorMsg);
  }

  //Valid Req Fields
  function validateReqFields( data, errors ) {

    // validateField( data.amountIs === 'Tax Inclusive', "Expense Error", errors  );

    validateField( typeof data.expenseDate === 'undefined', "Please select Date", errors  );
    validateField( typeof data.paidThroughAccountId === 'undefined', "Please select paid through account", errors  );
    validateField( typeof data.expense === 'undefined', "Please select expense account", errors  );

    validateField( data.sourceOfSupply === 'undefined', "Please select source of supply", errors  );
    
    
    // Determine if it is Expense Mileage or Record Expense
    const isNotMileage = ( typeof data.distance === "undefined") && ( typeof data.ratePerKm === "undefined");    
    
    if (isNotMileage) {
      validateField( data.destinationOfSupply === 'undefined', "Please select destination of supply", errors  );
      validateField( data.gstTreatment === "undefined", "Please select an gst treatment", errors);
      validateField( typeof data.grandTotal === "undefined", "Please enter the amount", errors);  
    } else {
      validateField( typeof data.distance === "undefined", "Please enter distance", errors);
      validateField( typeof data.ratePerKm === "undefined", "Please enter rate per kilometer", errors);
    }
  }


  // Validate Expense Type
  function validateExpenseType(expenseType, errors) {
    validateField(
      expenseType && !validExpenseType.includes(expenseType),
      "Invalid Expense Type: " + expenseType, errors );
  } 

   // Validate Amount is
   function validateAmountIs(amountIs, errors) {
    validateField(
      amountIs && !validAmountIs.includes(amountIs),
      "Invalid Amount Is: " + amountIs, errors );
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


// Validate GST or VAT details
function validateGSTorVAT(data, errors) {
  data.expense.forEach((expenseItem) => {
    const taxGroup = expenseItem.taxGroup;

    // Validate that taxGroup is a string
    if (typeof taxGroup !== "string") {
      errors.push(`Invalid or missing taxGroup: ${taxGroup}`);
      return; // Skip processing for this expense item
    }

    // Extract the first three letters
    const TaxGroup = taxGroup.substring(0, 3);

    if (TaxGroup === "GST") {
      validateGSTDetails(expenseItem, errors);
    } else if (TaxGroup === "VAT") {
      validateVATDetails(expenseItem, errors);
    } else if (taxGroup === "Non-Taxable" || taxGroup === "GST0") {
      clearTaxFields(expenseItem);
    } else {
      // Handle unexpected taxGroup values
      errors.push(`Invalid taxGroup: ${taxGroup}`);
    }
  });
}





// Validate GST details
function validateGSTDetails(data, errors) {
  validateField(
    data.gstTreatment && !validGSTTreatments.includes(data.gstTreatment),
    `Invalid GST treatment: ${data.gstTreatment}`, 
    errors
  );
  validateField(
    data.gstin && !isAlphanumeric(data.gstin),
    `Invalid GSTIN/UIN: ${data.gstin}`, 
    errors
  );
}

// Validate VAT details
function validateVATDetails(data, errors) {
  validateField(
    data.vat && !isAlphanumeric(data.vat),
    `Invalid VAT number: ${data.vat}`, 
    errors
  );
}


// Clear tax fields when no tax is applied
function clearTaxFields(data) {
  ['gstTreatment', 'gstin', 'amountIs'].forEach(field => {
    data[field] = undefined;
  });
}




 //Valid Float Fields  
 function validateFloatFields(fields, data, errors) {
  fields.forEach((balance) => {
    validateField(data[balance] && !isFloat(data[balance]),
      "Invalid " + balance.replace(/([A-Z])/, " $1") + ": " + data[balance], errors);
  });
}


  // Helper functions to handle formatting
  function capitalize(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  function formatCamelCase(word) {
    return word.replace(/([A-Z])/, " $1");
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
  function isValidURL(value) {
    return /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?$/.test(value);
  }






// Utility Functions
const validExpenseType = ["Goods", "Service"];
const validAmountIs = ["Tax Inclusive", "Tax Exclusive"];     
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
const validGSTTreatments = [
  "Out Of Scope",
  "Registered Business - Regular",
  "Registered Business - Composition",
  "Unregistered Business",
  "Consumer",
  "Overseas",
  "Special Economic Zone",
  "Deemed Export",
  "Tax Deductor",
  "SEZ Developer",
];





async function journal( savedExpense, defAcc, paidThroughAcc ) { 
  // console.log("savedExpense",savedExpense);
  const cgst = {
    organizationId: savedExpense.organizationId,
    operationId: savedExpense._id,
    transactionId: savedExpense.expenseNumber,
    date: savedExpense.createdDate,
    accountId: defAcc.inputCgst || undefined,
    action: "Expense",
    debitAmount: savedExpense.cgst || 0,
    creditAmount: 0,
    remark: savedExpense.expense.note,
    createdDateTime:savedExpense.createdDateTime
  };
  const sgst = {
    organizationId: savedExpense.organizationId,
    operationId: savedExpense._id,
    transactionId: savedExpense.expenseNumber,
    date: savedExpense.createdDate,
    accountId: defAcc.inputSgst || undefined,
    action: "Expense",
    debitAmount: savedExpense.sgst || 0,
    creditAmount: 0,
    remark: savedExpense.expense.note,
    createdDateTime:savedExpense.createdDateTime
  };
  const igst = {
    organizationId: savedExpense.organizationId,
    operationId: savedExpense._id,
    transactionId: savedExpense.expenseNumber,
    date: savedExpense.createdDate,
    accountId: defAcc.inputIgst || undefined,
    action: "Expense",
    debitAmount: savedExpense.igst || 0,
    creditAmount: 0,
    remark: savedExpense.expense.note,
    createdDateTime:savedExpense.createdDateTime
  };
  const vat = {
    organizationId: savedExpense.organizationId,
    operationId: savedExpense._id,
    transactionId: savedExpense.expenseNumber,
    date: savedExpense.createdDate,
    accountId: defAcc.inputVat || undefined,
    action: "Expense",
    debitAmount: savedExpense.vat || 0,
    creditAmount: 0,
    remark: savedExpense.expense.note,
    createdDateTime:savedExpense.createdDateTime
  };
  const paidThroughAccount = {
    organizationId: savedExpense.organizationId,
    operationId: savedExpense._id,
    transactionId: savedExpense.expenseNumber,
    accountId: paidThroughAcc || undefined,
    action: "Expense",
    debitAmount: 0,
    creditAmount: savedExpense.grandTotal || 0,
    remark: savedExpense.expense.note,
    createdDateTime:savedExpense.createdDateTime
  };

  

  let expenseTotalDebit = 0;

  if (Array.isArray(savedExpense.expense)) {
    savedExpense.expense.forEach((entry) => {
      console.log( "Account Log", entry.expenseAccountId, entry.total );      
      expenseTotalDebit += entry.total || 0;
    });
    console.log("Total Debit Amount from expense:", expenseTotalDebit);
  } else {
    console.error("Expense is not an array or is undefined.");
  }

  


  console.log("cgst", cgst.debitAmount,  cgst.creditAmount);
  console.log("sgst", sgst.debitAmount,  sgst.creditAmount);
  console.log("igst", igst.debitAmount,  igst.creditAmount);
  console.log("vat", vat.debitAmount,  vat.creditAmount);
  console.log("paidThroughAccount", paidThroughAccount.debitAmount,  paidThroughAccount.creditAmount);
  console.log("Total expense amount:", expenseTotalDebit);



  const  debitAmount = expenseTotalDebit + cgst.debitAmount  + sgst.debitAmount + igst.debitAmount +  vat.debitAmount;
  console.log("Total Debit Amount: ", debitAmount );


  //Expense
  savedExpense.expense.forEach((entry) => {
    const data = {
      organizationId: savedExpense.organizationId,
      operationId: savedExpense._id,
      transactionId: savedExpense.expenseNumber,
      date: savedExpense.createdDateTime,
      accountId: entry.expenseAccountId || undefined,
      action: "Expense",
      debitAmount: entry.total || 0,
      creditAmount: 0,
      remark: entry.note,
      createdDateTime:savedExpense.createdDateTime
    };
    console.log("Data",data);
    
    createTrialEntry( data )
  });



  //Tax
  if(savedExpense.cgst){
    createTrialEntry( cgst )
  }
  if(savedExpense.sgst){
    createTrialEntry( sgst )
  }
  if(savedExpense.igst){
    createTrialEntry( igst )
  }
  if(savedExpense.vat){
    createTrialEntry( vat )
  }
  if(savedExpense.paidThroughAccountId){
    createTrialEntry( paidThroughAccount )
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
  console.log("newTrialEntry:",newTrialEntry);
  
  }
  
}
















exports.dataExist = {
  dataExist,
  accDataExists,
  expenseDataExist
};
exports.validation = {
  validateOrganizationSupplierAccount, 
  validateInputs
};
exports.calculation = { 
  taxMode,
  calculateExpense
};
exports.accounts = { 
  defaultAccounting,
  journal
};