const Expense = require("../../database/model/expense");
const Organization = require("../../database/model/organization");
const Accounts = require("../../database/model/account");

const moment = require("moment-timezone");
const mongoose = require('mongoose');


const dataExist = async ( organizationId ) => {    
    const [organizationExists, allExpense ] = await Promise.all([
      Organization.findOne({ organizationId },{ timeZoneExp: 1, dateFormatExp: 1, dateSplit: 1, organizationCountry: 1 })
      .lean(),
      Expense.find({ organizationId }, {_id: 1, supplierId: 1, expense: 1, expenseCategory: 1, grandTotal: 1, sgst: 1, cgst: 1, igst: 1, vat: 1, createdDateTime: 1 })
      .populate('supplierId', 'supplierDisplayName')    
      .populate('expense.expenseAccountId', 'accountName')    
      .lean(),
    ]);
    return { organizationExists, allExpense };
};



// get date range
const getDateRange = (filterType, date, timeZone) => {
    
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




// Dashboard overview function
exports.getOverviewData = async (req, res) => {
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


        // Filter expense within the date range (using organization time zone)
        const filteredExpense = allExpense.filter(expense => {
            const expenseDate = moment.tz(expense.createdDateTime, orgTimeZone);
            return expenseDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered Expense:", filteredExpense);

        // Calculate total expense **without taxation**
        const totalExpense = filteredExpense.reduce((sum, data) => {
            const taxAmount = (data.sgst || 0) + (data.cgst || 0) + (data.igst || 0) + (data.vat || 0);
            console.log("taxAmount:",taxAmount);
            return sum + (data.grandTotal - taxAmount);
        }, 0);

        // Expense Reports Submitted (expense count)
        const expenseReportsSubmitted = filteredExpense.length;

        console.log("Final Calculations:", { totalExpense, expenseReportsSubmitted });

        // Response JSON
        res.json({
            totalExpense,
            expenseReportsSubmitted
        });

    } catch (error) {
        console.error("Error fetching overview data:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};




// Total Expense Over Time
exports.getExpenseOverTime = async (req, res) => {
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

        // Initialize an object to store expense per day
        let dailyExpense = {};

        // Loop through the days of the month
        let currentDate = startDate.clone();
        while (currentDate.isBefore(endDate) || currentDate.isSame(endDate, "day")) {
            dailyExpense[currentDate.format("YYYY-MM-DD")] = 0;
            currentDate.add(1, "day");
        }

        // Filter expense within the date range (using organization time zone)
        allExpense.forEach(expense => {
            const expenseDate = moment.tz(expense.createdDateTime, orgTimeZone).format("YYYY-MM-DD");
            const taxAmount = (expense.sgst || 0) + (expense.cgst || 0) + (expense.igst || 0) + (expense.vat || 0);
            console.log("taxAmount:",taxAmount);
            if (dailyExpense[expenseDate] !== undefined) {
                dailyExpense[expenseDate] += (expense.grandTotal - taxAmount) || 0;
            }
        });

        console.log("Daily Expense Breakdown:", dailyExpense);

        // Convert daily expense object to an array for better response format
        const dailyExpenseArray = Object.keys(dailyExpense).map(date => ({
            date,
            totalExpense: dailyExpense[date]
        }));

        // Total Expense: Sum of totalAmount from expense filtered for the selected range
        const totalExpense = dailyExpenseArray.reduce((sum, day) => sum + day.totalExpense, 0);

        // Response JSON
        res.json({
            totalExpense,
            dailyExpense: dailyExpenseArray
        });

    } catch (error) {
        console.error("Error fetching expense over time data:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};




// Top 5 Expense By Category
exports.getTopExpenseByCategory = async (req, res) => {
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

        // Filter expenses within the date range (using organization time zone)
        const filteredExpense = allExpense.filter(expense => {
            const expenseDate = moment.tz(expense.createdDateTime, orgTimeZone);
            return expenseDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered Expense:", filteredExpense);

        // Exclude expenses with undefined or null expenseCategory
        const validExpenses = filteredExpense.filter(expense => expense.expenseCategory);

        // Group by expense category and calculate total expense per category
        const expenseByCategory = validExpenses.reduce((acc, expense) => {
            const category = expense.expenseCategory; // Now we are sure it's defined
            const taxAmount = (expense.sgst || 0) + (expense.cgst || 0) + (expense.igst || 0) + (expense.vat || 0);
            const netExpense = expense.grandTotal - taxAmount; // Excluding tax

            acc[category] = (acc[category] || 0) + netExpense;
            return acc;
        }, {});

        // Convert object to array and sort by total expense in descending order
        const topExpenseByCategory = Object.entries(expenseByCategory)
            .map(([category, totalExpense]) => ({ category, totalExpense }))
            .sort((a, b) => b.totalExpense - a.totalExpense) // Sort by highest expense first
            .slice(0, 5); // Get top 5 categories

        console.log("Final Calculations:", { topExpenseByCategory });

        // Response JSON
        res.json({
            topExpenseByCategory,
        });

    } catch (error) {
        console.error("Error fetching top 5 expense by category:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};




// Expense breakdown by category - already used in main dashboard (Organization)



// expense Breakdown by Supplier
exports.getExpenseBreakdownBySupplier = async (req, res) => {
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

        // Filter expenses within the date range
        const filteredExpense = allExpense.filter(expense => {
            const expenseDate = moment.tz(expense.createdDateTime, orgTimeZone);
            return expenseDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered Expense:", filteredExpense);

        // Group by supplier and calculate total expense, count transactions, and compute average
        const expenseBySupplier = filteredExpense.reduce((acc, expense) => {
            if (!expense.supplierId) return acc; // Skip if supplierId is undefined

            const supplierName = expense.supplierId.supplierDisplayName || "Unknown Supplier";
            const taxAmount = (expense.sgst || 0) + (expense.cgst || 0) + (expense.igst || 0) + (expense.vat || 0);
            const netExpense = expense.grandTotal - taxAmount; // Excluding tax

            if (!acc[supplierName]) {
                acc[supplierName] = { totalExpense: 0, transactionCount: 0 };
            }

            acc[supplierName].totalExpense += netExpense;
            acc[supplierName].transactionCount += 1;
            return acc;
        }, {});

        // Convert object to array and compute average expense per transaction
        const expenseBreakdownBySupplier = Object.entries(expenseBySupplier).map(([supplier, data]) => ({
            supplier,
            totalExpense: data.totalExpense,
            numberOfTransactions: data.transactionCount,
            averageExpensePerTransaction: data.transactionCount > 0 ? (data.totalExpense / data.transactionCount).toFixed(2) : 0
        }));

        console.log("Final Calculations:", { expenseBreakdownBySupplier });

        // Response JSON
        res.json({
            expenseBreakdownBySupplier,
        });

    } catch (error) {
        console.error("Error fetching expense breakdown by supplier:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};



