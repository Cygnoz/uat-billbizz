const Customer = require("../database/model/customer");
const SalesInvoice = require("../database/model/salesInvoice");
const Organization = require("../database/model/organization");
const Item = require("../database/model/item");
const ItemTrack = require("../database/model/itemTrack");
const TrialBalance = require("../database/model/trialBalance");
const Expense = require('../database/model/expense');
const Account = require('../database/model/account');

const moment = require("moment-timezone");
const mongoose = require('mongoose');

const { singleCustomDateTime, multiCustomDateTime } = require("../services/timeConverter");



const dataExist = async ( organizationId ) => {    
    const [organizationExists, allInvoice, allCustomer, allItem, allExpense ] = await Promise.all([
      Organization.findOne({ organizationId },{ timeZoneExp: 1, dateFormatExp: 1, dateSplit: 1, organizationCountry: 1 })
      .lean(),
      SalesInvoice.find({ organizationId }, {_id: 1, customerId: 1, items: 1, paidStatus: 1, paidAmount: 1, totalAmount: 1, saleAmount: 1, createdDateTime: 1 })
      .populate('items.itemId', 'itemName') 
      .populate('customerId', 'customerDisplayName')    
      .lean(),
      Customer.find({ organizationId }, {_id: 1, customerDisplayName: 1, createdDateTime: 1 })
      .lean(),
      Item.find({ organizationId }, {_id: 1, itemName: 1 })
      .lean(),
      Expense.find({ organizationId }, {_id: 1, expense: 1, expenseCategory: 1, grandTotal: 1, createdDateTime: 1 })
      .populate('expense.expenseAccountId', 'accountName') 
      .lean()
    ]);
    return { organizationExists, allInvoice, allCustomer, allItem, allExpense };
};



//Xs Item Exist
const xsItemDataExists = async (organizationId) => {
    const [newItems] = await Promise.all([
      Item.find( { organizationId }, { _id: 1, itemName: 1, itemImage: 1, costPrice:1, createdDateTime: 1 } )
      .lean(),                  
    ]);         

    // Extract itemIds from newItems
    const itemIds = newItems.map(item => new mongoose.Types.ObjectId(item._id));
  
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
    const enrichedItems = newItems.map(item => {
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



// get date range
const getDateRange = (filterType, date, timeZone) => {
    
     // const momentDate = moment.tz(date, timeZone);

    // Ensure the date format is YYYY-MM-DD to avoid Moment.js deprecation warning
    const formattedDate = date.replace(/\//g, "-"); // Ensure YYYY-MM-DD format
    const utcDate = new Date(formattedDate); // Convert to Date object
    const momentDate = moment.tz(utcDate, timeZone); // Use time zone

    switch (filterType) {
        case "month":
            return {
                startDate: momentDate.clone().startOf("month"),
                endDate: momentDate.clone().endOf("month"),
            };
        case "year":
            return {
                startDate: momentDate.clone().startOf("year"),
                endDate: momentDate.clone().endOf("year"),
            };
        case "day":
            return {
                startDate: momentDate.clone().startOf("day"),
                endDate: momentDate.clone().endOf("day"),
            };
        default:
            throw new Error("Invalid filter type. Use 'month', 'year', or 'day'.");
    }
};



// Helper function to parse dates for total revenue
function parseDate( timezone, dateStr, isEndDate = false ) {
    const [day, month, year] = dateStr.split('-');
    let date = moment.tz(`${year}-${month}-${day}`, timezone);
    if (isEndDate) {
        date = date.endOf('day');
    }
    return date.toDate();
}




// Main Dashboard overview function
exports.getOverviewData = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date } = req.query; // Get date in YYYY/MM or YYYY-MM format

        // Validate date format (YYYY/MM or YYYY-MM)
        if (!date || !/^\d{4}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY/MM or YYYY-MM." });
        }

        // Fetch Organization Data
        const { organizationExists, allInvoice, allCustomer, allItem, allExpense } = await dataExist(organizationId);
        if (!organizationExists) return res.status(404).json({ message: "Organization not found!" });

        // Get organization's time zone
        const orgTimeZone = organizationExists.timeZoneExp || "UTC";

        // Extract Year and Month
        let [year, month] = date.split(/[-/]/).map(Number); // Split date on "-" or "/"
        month = String(month).padStart(2, '0'); // Ensure month is always two digits

        // Ensure valid year and month
        if (!year || !month || month < 1 || month > 12) {
            return res.status(400).json({ message: "Invalid year or month in date." });
        }

        // Set start and end date for the month
        const startDate = moment.tz(`${year}-${month}-01`, orgTimeZone).startOf("month");
        const endDate = moment(startDate).endOf("month");

        console.log("Requested Date Range:", startDate.format(), endDate.format());

        const { enrichedItems } = await xsItemDataExists(organizationId);

        // Filter invoices within the date range (using organization time zone)
        const filteredInvoices = allInvoice.filter(inv => {
            const invoiceDate = moment.tz(inv.createdDateTime, orgTimeZone);
            return invoiceDate.isBetween(startDate, endDate, null, "[]");
        });

        // console.log("Filtered Invoices:", filteredInvoices);

        // Total Revenue: Sum of paidAmount where paidStatus is "Completed"
        // const totalRevenue = filteredInvoices
        //     .filter(inv => inv.paidStatus === "Completed")
        //     .reduce((sum, inv) => sum + (parseFloat(inv.paidAmount) || 0), 0);

        // Format start and end date for the database query
        const start = parseDate(orgTimeZone, startDate.format("DD-MM-YYYY"));
        const end = parseDate(orgTimeZone, endDate.format("DD-MM-YYYY"), true);

        console.log("start and end",start,end)

        const sales = await getReportAccount( organizationExists, organizationId, start, end,'Sales'); 
        const indirectIncome = await getReportAccount( organizationExists, organizationId, start, end,'Indirect Income');   

        console.log("sales and indirectIncome",sales,indirectIncome)

        // Total Revenue
        const totalRevenue = sales.overallNetCredit + indirectIncome.overallNetCredit;  

        // Total Inventory Value: Sum of (currentStock * costPrice)
        const filteredItems = enrichedItems.filter(item =>
            moment.tz(item.createdDateTime, orgTimeZone).isBetween(startDate, endDate, null, "[]")
        );

        // console.log("Filtered Items:", filteredItems);

        const totalInventoryValue = filteredItems.reduce(
            (sum, item) => sum + ((parseFloat(item.currentStock) || 0) * (parseFloat(item.costPrice) || 0)), 
            0
        );

        // Total Expenses: Sum of grandTotal from expenses filtered for the selected range
        const filteredExpenses = allExpense.filter(exp =>
            moment.tz(exp.createdDateTime, orgTimeZone).isBetween(startDate, endDate, null, "[]")
        );

        // console.log("Filtered Expenses:", filteredExpenses);

        const totalExpenses = filteredExpenses.reduce(
            (sum, exp) => sum + (parseFloat(exp.grandTotal) || 0), 
            0
        );

        // New Customers: Count of customers created in the selected range
        const newCustomerCount = allCustomer.filter(customer =>
            moment.tz(customer.createdDateTime, orgTimeZone).isBetween(startDate, endDate, null, "[]")
        ).length;

        // Total Sales: Sum of saleAmount from sales invoices filtered for the selected range
        const totalSales = filteredInvoices.reduce(
            (sum, inv) => sum + (parseFloat(inv.saleAmount) || 0), 
            0
        );

        console.log("Final Calculations:", { totalRevenue, totalInventoryValue, totalExpenses, newCustomerCount, totalSales });

        // Response JSON
        res.json({
            totalRevenue,
            totalInventoryValue,
            totalExpenses,
            newCustomer: newCustomerCount,
            totalSales,
        });

    } catch (error) {
        console.error("Error fetching overview data:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};




// // Sales Over Time
exports.getSalesOverTime = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date } = req.query; // Get date in YYYY/MM or YYYY-MM format

        // Validate date format (YYYY/MM or YYYY-MM)
        if (!date || !/^\d{4}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY/MM or YYYY-MM." });
        }

        // Fetch Organization Data
        const { organizationExists, allInvoice } = await dataExist(organizationId);
        if (!organizationExists) return res.status(404).json({ message: "Organization not found!" });

        // Get organization's time zone
        const orgTimeZone = organizationExists.timeZoneExp || "UTC";

        // Extract Year and Month
        let [year, month] = date.split(/[-/]/).map(Number); // Split date on "-" or "/"
        month = String(month).padStart(2, '0'); // Ensure month is always two digits

        // Ensure valid year and month
        if (!year || !month || month < 1 || month > 12) {
            return res.status(400).json({ message: "Invalid year or month in date." });
        }

        // Set start and end date for the month
        const startDate = moment.tz(`${year}-${month}-01`, orgTimeZone).startOf("month");
        const endDate = moment(startDate).endOf("month");

        console.log("Requested Date Range:", startDate.format(), endDate.format());

        // Initialize an object to store sales per day
        let dailySales = {};

        // Loop through the days of the month
        let currentDate = startDate.clone();
        while (currentDate.isBefore(endDate) || currentDate.isSame(endDate, "day")) {
            dailySales[currentDate.format("YYYY-MM-DD")] = 0;
            currentDate.add(1, "day");
        }

        // Filter invoices within the date range (using organization time zone)
        allInvoice.forEach(inv => {
            const invoiceDate = moment.tz(inv.createdDateTime, orgTimeZone).format("YYYY-MM-DD");
            if (dailySales[invoiceDate] !== undefined) {
                dailySales[invoiceDate] += parseFloat(inv.saleAmount) || 0;
            }
        });

        console.log("Daily Sales Breakdown:", dailySales);

        // Convert daily sales object to an array for better response format
        const dailySalesArray = Object.keys(dailySales).map(date => ({
            date,
            totalSales: dailySales[date]
        }));

        // Total Sales: Sum of saleAmount from sales invoices filtered for the selected range
        const totalSales = dailySalesArray.reduce((sum, day) => sum + day.totalSales, 0);

        // Response JSON
        res.json({
            totalSales,
            dailySales: dailySalesArray
        });

    } catch (error) {
        console.error("Error fetching sales over time data:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};






// Expense By Category
exports.getExpenseByCategory = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date } = req.query; // Get date in YYYY/MM or YYYY-MM format

        // Validate date format (YYYY/MM or YYYY-MM)
        if (!date || !/^\d{4}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY/MM or YYYY-MM." });
        }

        // Fetch Organization Data
        const { organizationExists, allExpense } = await dataExist(organizationId);
        if (!organizationExists) return res.status(404).json({ message: "Organization not found!" });

        // Get organization's time zone
        const orgTimeZone = organizationExists.timeZoneExp || "UTC";

        // Extract Year and Month
        let [year, month] = date.split(/[-/]/).map(Number); // Split date on "-" or "/"
        month = String(month).padStart(2, '0'); // Ensure month is always two digits

        // Ensure valid year and month
        if (!year || !month || month < 1 || month > 12) {
            return res.status(400).json({ message: "Invalid year or month in date." });
        }

        // Set start and end date for the month
        const startDate = moment.tz(`${year}-${month}-01`, orgTimeZone).startOf("month");
        const endDate = moment(startDate).endOf("month");

        console.log("Requested Date Range:", startDate.format(), endDate.format());

        // Filter expenses based on date range
        const filteredExpenses = allExpense.filter(exp =>
            moment.tz(exp.createdDateTime, orgTimeZone).isBetween(startDate, endDate, null, "[]")
        );

        console.log("Filtered Expenses (before category check):", filteredExpenses);

        // Remove expenses without a valid category
        const validExpenses = filteredExpenses.filter(exp => exp.expenseCategory && exp.expenseCategory.trim() !== "");

        console.log("Valid Expenses (With Category):", validExpenses);

        // If no valid expenses are found, return an empty response
        if (validExpenses.length === 0) {
            return res.json({ category: [] });
        }

        // Group expenses by category
        const expenseByCategory = validExpenses.reduce((acc, exp) => {
            const category = exp.expenseCategory;
            const total = parseFloat(exp.grandTotal) || 0;

            if (!acc[category]) {
                acc[category] = 0;
            }
            acc[category] += total;
            return acc;
        }, {});

        // Convert grouped data to an array format
        const categoryArray = Object.entries(expenseByCategory).map(([category, total]) => ({
            category,
            total: total.toFixed(2), // Keep two decimal places
        }));

        // Response JSON
        res.json({
            category: categoryArray
        });

    } catch (error) {
        console.error("Error fetching expense by category:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};




// Top Selling Product
exports.getTopProductCustomer = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date } = req.query; // Get date in YYYY/MM or YYYY-MM format

        // Validate date format (YYYY/MM or YYYY-MM)
        if (!date || !/^\d{4}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY/MM or YYYY-MM." });
        }

        // Fetch Organization Data
        const { organizationExists, allInvoice } = await dataExist(organizationId);
        if (!organizationExists) return res.status(404).json({ message: "Organization not found!" });

        // Get organization's time zone
        const orgTimeZone = organizationExists.timeZoneExp || "UTC";

        // Extract Year and Month
        let [year, month] = date.split(/[-/]/).map(Number); // Split date on "-" or "/"
        month = String(month).padStart(2, '0'); // Ensure month is always two digits

        // Ensure valid year and month
        if (!year || !month || month < 1 || month > 12) {
            return res.status(400).json({ message: "Invalid year or month in date." });
        }

        // Set start and end date for the month
        const startDate = moment.tz(`${year}-${month}-01`, orgTimeZone).startOf("month");
        const endDate = moment(startDate).endOf("month");

        console.log("Requested Date Range:", startDate.format(), endDate.format());

        // Filter invoices within the date range (using organization time zone)
        const filteredInvoices = allInvoice.filter(inv => {
            const invoiceDate = moment.tz(inv.createdDateTime, orgTimeZone);
            return invoiceDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered Invoices:", filteredInvoices);

        // Sort invoices by saleAmount in descending order & take top 5
        const topInvoices = filteredInvoices
            .sort((a, b) => b.saleAmount - a.saleAmount) // Sort in descending order
            .slice(0, 5); // Get top 5

        console.log("Top 5 Invoices:", topInvoices);

        // Extract unique product IDs & their names
        let topProducts = {};
        topInvoices.forEach(inv => {
            inv.items.forEach(item => {
                if (item.itemId) {
                    const itemId = item.itemId._id.toString(); // Ensure ID is a string
                    const itemName = item.itemId.itemName || "Undefined";

                    if (!topProducts[itemId]) {
                        topProducts[itemId] = {
                            itemId,
                            itemName,
                            totalSold: 0
                        };
                    }
                    topProducts[itemId].totalSold += 1; // Count occurrences
                }
            });
        });

        // Convert object to an array & sort by totalSold count
        const sortedTopProducts = Object.values(topProducts)
            .sort((a, b) => b.totalSold - a.totalSold) // Sort descending by totalSold count
            .slice(0, 5); // Get top 5 products

        console.log("Top 5 Products:", sortedTopProducts);

        // 🔹 NEW: Find top 7 customers by total purchase amount
        let customerSales = {};

        filteredInvoices.forEach(inv => {
            if (inv.customerId) {
                const customerId = inv.customerId._id.toString(); // Convert ObjectId to string
                const customerName = inv.customerId.customerDisplayName || "Unknown Customer";

                if (!customerSales[customerId]) {
                    customerSales[customerId] = {
                        customerId,
                        customerName,
                        totalSpent: 0
                    };
                }
                customerSales[customerId].totalSpent += inv.saleAmount; // Sum total purchase
            }
        });

        // Convert object to an array & sort by totalSpent
        const topCustomers = Object.values(customerSales)
            .sort((a, b) => b.totalSpent - a.totalSpent) // Sort by total spent
            .slice(0, 7); // Get top 7 customers

        console.log("Top 7 Customers:", topCustomers);

        // Response JSON
        res.json({
            topProducts: sortedTopProducts,
            topCustomers: topCustomers
        });

    } catch (error) {
        console.error("Error fetching top selling product and customers:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};







// Report for single subhead
async function getReportAccount(organizationExists,organizationId, startDate, endDate, accountSubHead) {
    try {
        const openingBalances = await TrialBalance.aggregate([
            {
                $match: {
                    organizationId: organizationId,
                    createdDateTime: { $lt: startDate }
                }
            },
            {
                $lookup: {
                    from: "accounts",
                    localField: "accountId",
                    foreignField: "_id",
                    as: "accountDetails"
                }
            },
            { $unwind: "$accountDetails" },
            { $match: { "accountDetails.accountSubhead": accountSubHead } },
            {
                $group: {
                    _id: "$accountId",
                    accountName: { $first: "$accountDetails.accountName" },
                    totalDebit: { $sum: "$debitAmount" },
                    totalCredit: { $sum: "$creditAmount" }
                }
            },
            {
                $set: {
                    totalDebit: {
                        $cond: {
                            if: { $gt: ["$totalDebit", "$totalCredit"] },
                            then: { $subtract: ["$totalDebit", "$totalCredit"] },
                            else: 0
                        }
                    },
                    totalCredit: {
                        $cond: {
                            if: { $gt: ["$totalCredit", "$totalDebit"] },
                            then: { $subtract: ["$totalCredit", "$totalDebit"] },
                            else: 0
                        }
                    }
                }
            }
        ]);
        

        const transactions = await TrialBalance.aggregate([
            {
                $match: {
                    organizationId: organizationId,
                    createdDateTime: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $lookup: {
                    from: "accounts",
                    localField: "accountId",
                    foreignField: "_id",
                    as: "accountDetails"
                }
            },
            { $unwind: "$accountDetails" },
            { $match: { "accountDetails.accountSubhead": accountSubHead } },
            {
                $match: {
                    $or: [{ debitAmount: { $ne: 0 } }, { creditAmount: { $ne: 0 } }]
                }
            },
            {
                $project: {
                    accountId: 1,
                    accountName: "$accountDetails.accountName",
                    transactionId: 1,
                    operationId: 1,
                    date: "$createdDateTime",
                    debitAmount: 1,
                    creditAmount: 1
                }
            },
            {
                $addFields: {
                    month: {
                        $dateToString: {
                            format: "%B %Y",
                            date: "$date"
                        }
                    }
                }
            },
            {
                $group: {
                    _id: { accountId: "$accountId", accountName: "$accountName", month: "$month" },
                    transactions: {
                        $push: {
                            transactionId: "$transactionId",
                            operationId: "$operationId",
                            createdDateTime: "$date",
                            createdDate: null,
                            createdTime:null,
                            debitAmount: "$debitAmount",
                            creditAmount: "$creditAmount"
                        }
                    },
                    totalDebit: { $sum: "$debitAmount" },
                    totalCredit: { $sum: "$creditAmount" }
                }
            },
            {
                $set: {
                    totalDebit: {
                        $cond: {
                            if: { $gt: ["$totalDebit", "$totalCredit"] },
                            then: { $subtract: ["$totalDebit", "$totalCredit"] },
                            else: 0
                        }
                    },
                    totalCredit: {
                        $cond: {
                            if: { $gt: ["$totalCredit", "$totalDebit"] },
                            then: { $subtract: ["$totalCredit", "$totalDebit"] },
                            else: 0
                        }
                    }
                }
            },
            {
                $group: {
                    _id: "$_id.accountId",
                    accountName: { $first: "$_id.accountName" },
                    overallNetDebit: { $sum: "$totalDebit" },
                    overallNetCredit: { $sum: "$totalCredit" },
                    entries: {
                        $push: {
                            date: "$_id.month",
                            transactions: "$transactions",
                            overAllNetDebit: "$totalDebit",
                            overAllNetCredit: "$totalCredit"
                        }
                    }
                }
            },
            {
                $set: {
                    overallNetDebit: {
                        $cond: {
                            if: { $gt: ["$overallNetDebit", "$overallNetCredit"] },
                            then: { $subtract: ["$overallNetDebit", "$overallNetCredit"] },
                            else: 0
                        }
                    },
                    overallNetCredit: {
                        $cond: {
                            if: { $gt: ["$overallNetCredit", "$overallNetDebit"] },
                            then: { $subtract: ["$overallNetCredit", "$overallNetDebit"] },
                            else: 0
                        }
                    }
                }
            }
        ]);

        // Apply formatting after aggregation
        const formattedTransactions = transactions.map(account => {
            
            // Ensure entries exist
            if (!Array.isArray(account.entries)) {
                account.entries = [];
            }
            
            // Loop through each entry and format its transactions
            account.entries.forEach(entry => {
                if (!Array.isArray(entry.transactions)) {
                    entry.transactions = []; // Ensure transactions is an array
                }
                
                entry.transactions = entry.transactions.map(transaction => {
                    const { dateFormatExp, timeZoneExp, dateSplit } = organizationExists;
                    
                    const formattedData = singleCustomDateTime( transaction.createdDateTime, dateFormatExp, timeZoneExp, dateSplit );
        
                    return {
                        ...transaction,
                        createdDate: formattedData.createdDate,
                        createdTime: formattedData.createdTime,
                    };
                });
            });
        
            return account;
        });
                

        let overallNetDebit = 0;
        let overallNetCredit = 0;

        const finalResult = formattedTransactions.map((account) => {
            const openingBalance = openingBalances.find(ob => ob._id.equals(account._id)) || { totalDebit: 0, totalCredit: 0 };

            const openingEntry = {
                date: "Opening Balance",
                transactions: [],
                overAllNetDebit: openingBalance.totalDebit,
                overAllNetCredit: openingBalance.totalCredit
            };

            account.entries.unshift(openingEntry);
            account.overallNetDebit += openingBalance.totalDebit;
            account.overallNetCredit += openingBalance.totalCredit;

            overallNetDebit += account.overallNetDebit;
            overallNetCredit += account.overallNetCredit;

            return {
                accountId: account._id,
                accountName: account.accountName,
                overallNetDebit: account.overallNetDebit,
                overallNetCredit: account.overallNetCredit,
                entries: account.entries
            };
        });

        // Adjusting overallNetDebit and overallNetCredit based on the condition
        if (overallNetDebit > overallNetCredit) {
            overallNetDebit -= overallNetCredit;
            overallNetCredit = 0;
        } else if (overallNetCredit > overallNetDebit) {
            overallNetCredit -= overallNetDebit;
            overallNetDebit = 0;
        }

        return {
            overallNetDebit,
            overallNetCredit,
            data: finalResult
        };

    } catch (error) {
        console.error("Error fetching data:", error);
        return { overallNetDebit: 0, overallNetCredit: 0, data: [] };
    }
}