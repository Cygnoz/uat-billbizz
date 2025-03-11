const SalesInvoice = require("../database/model/salesInvoice");
const Organization = require("../database/model/organization");
const PurchaseBill = require("../database/model/bills");
const TrialBalance = require("../database/model/trialBalance");
const Expense = require('../database/model/expense');
const Account = require('../database/model/account');
const Item = require("../database/model/item");
const Supplier = require("../database/model/supplier");
const Customer = require("../database/model/customer");

const moment = require("moment-timezone");
const mongoose = require('mongoose');

const { singleCustomDateTime, multiCustomDateTime } = require("../services/timeConverter");



const dataExist = async ( organizationId ) => {    
    const [organizationExists, allInvoice, allBills, allExpense, allTrialBalance ] = await Promise.all([
      Organization.findOne({ organizationId },{ timeZoneExp: 1, dateFormatExp: 1, dateSplit: 1, organizationCountry: 1 })
      .lean(),
      SalesInvoice.find({ organizationId }, {_id: 1, customerId: 1, items: 1, salesInvoiceDate: 1, dueDate: 1, paidStatus: 1, paidAmount: 1, saleAmount: 1, createdDateTime: 1 })
      .populate('items.itemId', 'itemName') 
      .populate('customerId', 'customerDisplayName')    
      .lean(),
      PurchaseBill.find({ organizationId }, {_id: 1, supplierId: 1, items: 1, purchaseOrderDate: 1, dueDate: 1, paidStatus: 1, paidAmount: 1, purchaseAmount: 1, createdDateTime: 1 })
      .populate('items.itemId', 'itemName') 
      .populate('supplierId', 'supplierDisplayName') 
      .lean(),
      Expense.find({ organizationId }, {_id: 1, expense: 1, expenseCategory: 1, grandTotal: 1, createdDateTime: 1 })
      .populate('expense.expenseAccountId', 'accountName') 
      .lean(),
      TrialBalance.find({ organizationId: organizationId, createdDateTime: 1 })
      .populate('accountId', 'accountName')    
      .lean(),
    ]);
    return { organizationExists, allInvoice, allBills, allExpense, allTrialBalance };
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



// Dashboard overview function
exports.getOverviewData = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date } = req.query; // Get date in YYYY/MM or YYYY-MM format

        // Validate date format (YYYY/MM or YYYY-MM)
        if (!date || !/^\d{4}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY/MM or YYYY-MM." });
        }

        // Fetch Organization Data
        const { organizationExists, allBills } = await dataExist(organizationId);
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

        // Filter bills within the date range
        const filteredBills = allBills.filter(bill => {
            const billDate = moment.tz(bill.createdDateTime, orgTimeZone);
            return billDate.isBetween(startDate, endDate, null, "[]");
        });

        // Format start and end date for the database query
        const start = parseDate(orgTimeZone, startDate.format("DD-MM-YYYY"));
        const end = parseDate(orgTimeZone, endDate.format("DD-MM-YYYY"), true);

        // console.log("start and end",start,end)

        const sales = await getReportAccount(organizationExists, organizationId, start, end, 'Sales'); 
        const indirectIncome = await getReportAccount(organizationExists, organizationId, start, end, 'Indirect Income');  
        
        // console.log("..............sales............", sales);
        // console.log("..............indirectIncome............", indirectIncome);

        // Total Revenue
        const totalRevenue = sales.overallNetCredit + indirectIncome.overallNetCredit;  


        const sundryCreditors = await getReportAccount( organizationExists, organizationId, start, end,'Sundry Creditors');  
        const sundryDebtors = await getReportAccount( organizationExists, organizationId, start, end,'Sundry Debtors');  

        // console.log("..............sundryCreditors............", sundryCreditors);
        // console.log("..............sundryDebtors............", sundryDebtors);

        // accounts Payable (convert negative values to positive)
        const accountsPayable = Math.abs(sundryCreditors.overallNetDebit - sundryCreditors.overallNetCredit);

        // accounts Receivable
        const accountsReceivable = (sundryDebtors.overallNetDebit - sundryDebtors.overallNetCredit);

        // Pending Bills
        const pendingBills = filteredBills.filter(bills => bills.paidStatus !== "Completed").length;

        console.log("Final Calculations:", { totalRevenue, accountsPayable, accountsReceivable, pendingBills });

        // Response JSON
        res.json({
            totalRevenue,
            accountsPayable,
            accountsReceivable,
            pendingBills,
        });

    } catch (error) {
        console.error("Error fetching overview data:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};



// Total Revenue Over Time
exports.getTotalRevenueOverTime = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        console.log("Id",organizationId)
        const { date } = req.query; // Get date in YYYY/MM or YYYY-MM format

        // Validate date format (YYYY/MM or YYYY-MM)
        if (!date || !/^\d{4}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY/MM or YYYY-MM." });
        }

        // Fetch Organization Data
        const { organizationExists } = await dataExist(organizationId);
        if (!organizationExists) return res.status(404).json({ message: "Organization not found!" });

        // Get organization's time zone
        const orgTimeZone = organizationExists.timeZoneExp || "UTC";

        // Extract Year and Month
        let [year, month] = date.split(/[-/]/).map(Number);
        month = String(month).padStart(2, '0'); // Ensure month is always two digits

        // Ensure valid year and month
        if (!year || !month || month < 1 || month > 12) {
            return res.status(400).json({ message: "Invalid year or month in date." });
        }

        // Set start and end date for the full month
        const startDate = moment.tz(`${year}-${month}-01`, orgTimeZone).startOf("month");
        const endDate = moment(startDate).endOf("month");

        console.log("Requested Date Range:", startDate.format(), endDate.format());

        // Initialize an object to store daily revenue
        let dailyRevenue = {};

        // Loop through each day of the month
        for (let day = 1; day <= endDate.date(); day++) {
            let currentDay = moment.tz(`${year}-${month}-${String(day).padStart(2, '0')}`, orgTimeZone).startOf("day");
            let nextDay = moment(currentDay).endOf("day");

            // Ensure we're only fetching full days (i.e., before today's date)
            if (currentDay.isBefore(moment().tz(orgTimeZone).startOf("day"))) {
                let start = parseDate(orgTimeZone, currentDay.format("DD-MM-YYYY"));
                let end = parseDate(orgTimeZone, nextDay.format("DD-MM-YYYY"), true);

                // console.log("start and end",start,end);

                // Fetch daily sales and indirect income
                const sales = await getReportAccount(organizationExists, organizationId, start, end, 'Sales');
                const indirectIncome = await getReportAccount(organizationExists, organizationId, start, end, 'Indirect Income');

                // console.log("sales",sales.overallNetCredit);

                // Calculate total revenue for the day
                dailyRevenue[currentDay.format("YYYY-MM-DD")] = sales.overallNetCredit + indirectIncome.overallNetCredit;
            }
        }

        // Convert daily revenue object to an array of { date, revenue }
        const dailyRevenueArray = Object.keys(dailyRevenue).map(date => ({
            date,
            revenue: dailyRevenue[date]
        }));

        // Calculate total revenue for the month
        const totalRevenue = dailyRevenueArray.reduce((sum, day) => sum + day.revenue, 0);

        console.log("Final Calculations:", { totalRevenue, dailyRevenueArray });

        // Response JSON
        res.json({
            totalRevenue,
            dailyRevenue: dailyRevenueArray
        });

    } catch (error) {
        console.error("Error fetching total revenue over time:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};



// Account Receivable Aging function
exports.getAccountReceivableAging = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date } = req.query; // Get year in YYYY format

        // Validate date format (YYYY)
        if (!date || !/^\d{4}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY." });
        }

        const year = Number(date); // Extract year

        // Fetch Organization Data
        const { organizationExists, allInvoice } = await dataExist(organizationId);
        if (!organizationExists) return res.status(404).json({ message: "Organization not found!" });

        // Get organization's time zone
        const orgTimeZone = organizationExists.timeZoneExp || "UTC";

        // Set start and end date for the full year
        const startDate = moment.tz(`${year}-01-01`, orgTimeZone).startOf("year");
        const endDate = moment(startDate).endOf("year");

        console.log("Requested Year Range:", startDate.format(), endDate.format());

        // Filter invoices for the selected year
        const filteredInvoices = allInvoice.filter(inv => {
            const invDate = moment.tz(inv.salesInvoiceDate, orgTimeZone);
            return invDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("filteredInvoices:",filteredInvoices);

        // Initialize aging buckets
        let agingBuckets = {
            "0-30 Days": 0,
            "31-60 Days": 0,
            "61-90 Days": 0,
            "Over 90 Days": 0
        };

        // Iterate through filtered invoices
        filteredInvoices.forEach(inv => {
            const invoiceDate = moment.tz(inv.salesInvoiceDate, orgTimeZone);
            let daysDifference = 0;

            if (inv.paidStatus === "Pending") {
                // Difference between salesInvoiceDate and dueDate
                const dueDate = moment.tz(inv.dueDate, orgTimeZone);
                daysDifference = dueDate.diff(invoiceDate, "days");
            } else if (inv.paidStatus === "Overdue") {
                // Difference between salesInvoiceDate and current date
                const currentDate = moment().tz(orgTimeZone);
                daysDifference = currentDate.diff(invoiceDate, "days");
            }

            // Categorize into aging buckets
            if (daysDifference <= 30) {
                agingBuckets["0-30 Days"] += inv.saleAmount;
            } else if (daysDifference <= 60) {
                agingBuckets["31-60 Days"] += inv.saleAmount;
            } else if (daysDifference <= 90) {
                agingBuckets["61-90 Days"] += inv.saleAmount;
            } else {
                agingBuckets["Over 90 Days"] += inv.saleAmount;
            }
        });

        console.log("Final Calculations:", agingBuckets);

        // Response JSON
        res.json({
            accountsReceivableAging: agingBuckets
        });

    } catch (error) {
        console.error("Error fetching account receivable aging:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};




// Account Payable Aging function
exports.getAccountPayableAging = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date } = req.query; // Year in YYYY format

        // Validate date format (YYYY)
        if (!date || !/^\d{4}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY." });
        }

        const year = Number(date);

        // Fetch organization data
        const { organizationExists, allBills } = await dataExist(organizationId);
        if (!organizationExists) return res.status(404).json({ message: "Organization not found!" });

        const orgTimeZone = organizationExists.timeZoneExp || "UTC";

        // Set start and end date for the full year
        const startDate = moment.tz(`${year}-01-01`, orgTimeZone).startOf("year");
        const endDate = moment(startDate).endOf("year");

        console.log("Requested Year Range:", startDate.format(), endDate.format());

        // Filter bills for the selected year
        const filteredBills = allBills.filter(bill => {
            const billDueDate = moment.tz(bill.dueDate, orgTimeZone);
            return billDueDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered Bills:", filteredBills);

        // Initialize a map to store aggregated results
        let agingMap = new Map();

        // Iterate through filtered bills
        filteredBills.forEach(bill => {
            const purchaseDate = moment.tz(bill.purchaseOrderDate, orgTimeZone);
            const dueDate = moment.tz(bill.dueDate, orgTimeZone);
            const currentDate = moment().tz(orgTimeZone);

            let daysDifference = 0;

            if (bill.paidStatus === "Pending") {
                daysDifference = dueDate.diff(purchaseDate, "days"); // Due date - Purchase date
            } else if (bill.paidStatus === "Overdue") {
                daysDifference = currentDate.diff(purchaseDate, "days"); // Today - Purchase date
            }

            let agingCategory = "";
            if (daysDifference <= 30) {
                agingCategory = "0-30 Days";
            } else if (daysDifference <= 60) {
                agingCategory = "31-60 Days";
            } else if (daysDifference <= 90) {
                agingCategory = "61-90 Days";
            } else {
                agingCategory = "Over 90 Days";
            }

            const supplierName = bill.supplierId?.supplierDisplayName || "Unknown Supplier";
            const key = `${supplierName}-${agingCategory}`;

            if (agingMap.has(key)) {
                agingMap.get(key).amount += bill.purchaseAmount;
            } else {
                agingMap.set(key, {
                    supplier: supplierName,
                    amount: bill.purchaseAmount,
                    dueDate: dueDate.format("DD MMM YY"), // Format: "01 June 24"
                    // paidStatus: bill.paidStatus,
                    // daysDifference: daysDifference,
                    aging: agingCategory
                });
            }
        });

        // Convert map values to an array
        const agingData = Array.from(agingMap.values());

        console.log("Final Aggregated Aging Data:", agingData);

        // Response JSON
        res.json({
            accountsPayableAging: agingData
        });

    } catch (error) {
        console.error("Error fetching account payable aging:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};



// Invoice status function
exports.getInvoiceStatus = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date } = req.query; // Expected format: YYYY/MM or YYYY-MM

        // Validate date format (YYYY/MM or YYYY-MM)
        if (!date || !/^\d{4}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY/MM or YYYY-MM." });
        }

        // Fetch organization data
        const { organizationExists, allInvoice } = await dataExist(organizationId);
        if (!organizationExists) return res.status(404).json({ message: "Organization not found!" });

        // Get organization's time zone
        const orgTimeZone = organizationExists.timeZoneExp || "UTC";

        // Extract year and month
        let [year, month] = date.split(/[-/]/).map(Number);
        month = String(month).padStart(2, '0'); // Ensure month is always two digits

        // Validate year and month
        if (!year || !month || month < 1 || month > 12) {
            return res.status(400).json({ message: "Invalid year or month in date." });
        }

        // Set start and end date for the selected month
        const startDate = moment.tz(`${year}-${month}-01`, orgTimeZone).startOf("month");
        const endDate = moment(startDate).endOf("month");

        console.log("Requested Date Range:", startDate.format(), endDate.format());

        // Filter invoices within the date range
        const filteredInvoices = allInvoice.filter(inv => {
            const invDate = moment.tz(inv.createdDateTime, orgTimeZone);
            return invDate.isBetween(startDate, endDate, null, "[]");
        });

        // Initialize invoice status counts
        let statusCounts = {
            Completed: 0,
            Pending: 0,
            Overdue: 0
        };

        // Count invoices for each status
        filteredInvoices.forEach(inv => {
            switch (inv.paidStatus) {
                case "Completed":
                    statusCounts.Completed++;
                    break;
                case "Pending":
                    statusCounts.Pending++;
                    break;
                case "Overdue":
                    statusCounts.Overdue++;
                    break;
                default:
                    break;
            }
        });

        console.log("Final Invoice Status Data:", statusCounts);

        // Response JSON
        res.json({
            invoiceStatus: statusCounts
        });

    } catch (error) {
        console.error("Error fetching invoice status data:", error);
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


