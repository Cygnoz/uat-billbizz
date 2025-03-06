const Customer = require("../database/model/customer");
const SalesInvoice = require("../database/model/salesInvoice");
const Organization = require("../database/model/organization");
const Item = require("../database/model/item");
const ItemTrack = require("../database/model/itemTrack");
const Expense = require('../database/model/expense');
const moment = require("moment-timezone");
const mongoose = require('mongoose');


const dataExist = async ( organizationId ) => {    
    const [organizationExists, allInvoice, allCustomer, allItem, allExpense ] = await Promise.all([
      Organization.findOne({ organizationId },{ timeZoneExp: 1, dateFormatExp: 1, dateSplit: 1, organizationCountry: 1, createdDateTime: 1 })
      .lean(),
      SalesInvoice.find({ organizationId }, {_id: 1, customerId: 1, items: 1, paidStatus: 1, paidAmount: 1, totalAmount: 1, createdDateTime: 1 })
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




// Main Dashboard overview function
exports.getOverviewData = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date, filterType } = req.query; // Get date & filter type (month, year, day)

        // Validate date input (YYYY-MM-DD or YYYY/MM/DD format)
        if (!date || !/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD or YYYY/MM/DD." });
        }

        // Fetch Organization Data
        const { organizationExists, allInvoice, allCustomer, allItem, allExpense } = await dataExist(organizationId);
        if (!organizationExists) return res.status(404).json({ message: "Organization not found!" });

        // Get organization's time zone
        const orgTimeZone = organizationExists.timeZoneExp || "UTC";
        console.log("orgTimeZone",orgTimeZone)

        // Get the date range based on filterType
        let startDate, endDate;
        try {
            ({ startDate, endDate } = getDateRange(filterType, date, orgTimeZone));
        } catch (error) {
            return res.status(400).json({ message: error.message });
        }

        console.log("Requested Date Range:", startDate.format(), endDate.format());

        const { enrichedItems } = await xsItemDataExists(organizationId);

        // Filter invoices within the date range (using organization time zone)
        const filteredInvoices = allInvoice.filter(inv => {
            const invoiceDate = moment.tz(inv.createdDateTime, orgTimeZone);
            return invoiceDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered Invoices:", filteredInvoices);

        // Total Revenue: Sum of paidAmount where paidStatus is "Completed"
        const totalRevenue = filteredInvoices
            .filter(inv => inv.paidStatus === "Completed")
            .reduce((sum, inv) => sum + (parseFloat(inv.paidAmount) || 0), 0);

        // Total Inventory Value: Sum of (currentStock * costPrice)
        const filteredItems = enrichedItems.filter(item =>
            moment.tz(item.createdDateTime, orgTimeZone).isBetween(startDate, endDate, null, "[]")
        );

        console.log("Filtered Items:", filteredItems);

        const totalInventoryValue = filteredItems.reduce(
            (sum, item) => sum + ((parseFloat(item.currentStock) || 0) * (parseFloat(item.costPrice) || 0)), 
            0
        );

        // Total Expenses: Sum of grandTotal from expenses filtered for the selected range
        const filteredExpenses = allExpense.filter(exp =>
            moment.tz(exp.createdDateTime, orgTimeZone).isBetween(startDate, endDate, null, "[]")
        );

        console.log("Filtered Expenses:", filteredExpenses);

        const totalExpenses = filteredExpenses.reduce(
            (sum, exp) => sum + (parseFloat(exp.grandTotal) || 0), 
            0
        );

        // New Customers: Count of customers created in the selected range
        const newCustomerCount = allCustomer.filter(customer =>
            moment.tz(customer.createdDateTime, orgTimeZone).isBetween(startDate, endDate, null, "[]")
        ).length;

        // Total Sales: Sum of totalAmount from sales invoices filtered for the selected range
        const totalSales = filteredInvoices.reduce(
            (sum, inv) => sum + (parseFloat(inv.totalAmount) || 0), 
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




// Sales Over Time
exports.getSalesOverTime = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date, filterType } = req.query; // Get date & filter type (month, year, day)

        // Validate date input (YYYY-MM-DD or YYYY/MM/DD format)
        if (!date || !/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD or YYYY/MM/DD." });
        }

        // Fetch Organization Data
        const { organizationExists, allInvoice } = await dataExist(organizationId);
        if (!organizationExists) return res.status(404).json({ message: "Organization not found!" });

        // Get organization's time zone
        const orgTimeZone = organizationExists.timeZoneExp || "UTC"; // Default to UTC if not provided

        // Get the date range based on filterType
        let startDate, endDate;
        try {
            ({ startDate, endDate } = getDateRange(filterType, date, orgTimeZone));
        } catch (error) {
            return res.status(400).json({ message: error.message });
        }

        console.log("Requested Date Range:", startDate.format(), endDate.format());

        // Filter invoices within the date range (using organization time zone)
        const filteredInvoices = allInvoice.filter(inv => {
            const invoiceDate = moment.tz(inv.createdDateTime, orgTimeZone);
            return invoiceDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered Invoices:", filteredInvoices);

        // Total Sales: Sum of totalAmount from sales invoices filtered for the selected range
        const totalSales = filteredInvoices.reduce(
            (sum, inv) => sum + (parseFloat(inv.totalAmount) || 0), 
            0
        );

        console.log("Final Calculations:", { totalSales });

        // Response JSON
        res.json({
            totalSales,
        });

    } catch (error) {
        console.error("Error fetching sales over time data:", error);
        res.status(500).json({ message: "Internal server error." });
    }
}




// Expense By Category
exports.getExpenseByCategory = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date, filterType } = req.query; // Get date & filter type (month, year, day)

        // Validate date input (YYYY-MM-DD or YYYY/MM/DD format)
        if (!date || !/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD or YYYY/MM/DD." });
        }

        // Fetch Organization Data
        const { organizationExists, allExpense } = await dataExist(organizationId);
        if (!organizationExists) return res.status(404).json({ message: "Organization not found!" });

        console.log("All Expenses:", allExpense);

        // Get organization's time zone
        const orgTimeZone = organizationExists.timeZoneExp || "UTC"; // Default to UTC if not provided

        // Get the date range based on filterType
        let startDate, endDate;
        try {
            ({ startDate, endDate } = getDateRange(filterType, date, orgTimeZone));
        } catch (error) {
            return res.status(400).json({ message: error.message });
        }

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
        const { date, filterType } = req.query; // Get date & filter type (month, year, day)

        // Validate date input (YYYY-MM-DD or YYYY/MM/DD format)
        if (!date || !/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD or YYYY/MM/DD." });
        }

        // Fetch Organization Data
        const { organizationExists, allInvoice } = await dataExist(organizationId);
        if (!organizationExists) return res.status(404).json({ message: "Organization not found!" });

        // Get organization's time zone
        const orgTimeZone = organizationExists.timeZoneExp || "UTC"; // Default to UTC if not provided

        // Get the date range based on filterType
        let startDate, endDate;
        try {
            ({ startDate, endDate } = getDateRange(filterType, date, orgTimeZone));
        } catch (error) {
            return res.status(400).json({ message: error.message });
        }

        console.log("Requested Date Range:", startDate.format(), endDate.format());

        // Filter invoices within the date range (using organization time zone)
        const filteredInvoices = allInvoice.filter(inv => {
            const invoiceDate = moment.tz(inv.createdDateTime, orgTimeZone);
            return invoiceDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered Invoices:", filteredInvoices);

        // Sort invoices by totalAmount in descending order & take top 5
        const topInvoices = filteredInvoices
            .sort((a, b) => b.totalAmount - a.totalAmount) // Sort in descending order
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
                customerSales[customerId].totalSpent += inv.totalAmount; // Sum total purchase
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







   