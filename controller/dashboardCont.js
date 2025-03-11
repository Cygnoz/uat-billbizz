const Customer = require("../database/model/customer");
const SalesInvoice = require("../database/model/salesInvoice");
const Organization = require("../database/model/organization");
const moment = require("moment-timezone");
const mongoose = require('mongoose');


const dataExist = async ( organizationId ) => {    
    const [organizationExists, allInvoice, allCustomer ] = await Promise.all([
      Organization.findOne({ organizationId },{ timeZoneExp: 1, dateFormatExp: 1, dateSplit: 1, organizationCountry: 1 })
      .lean(),
      SalesInvoice.find({ organizationId }, {_id: 1, customerId: 1, items: 1, paidStatus: 1, paidAmount: 1, totalAmount: 1, saleAmount: 1, createdDateTime: 1 })
      .populate('items.itemId', 'itemName') 
      .populate('customerId', 'customerDisplayName')    
      .lean(),
      Customer.find({ organizationId }, {_id: 1, customerDisplayName: 1, status: 1, createdDateTime: 1 })
      .lean()
    ]);
    return { organizationExists, allInvoice, allCustomer };
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
        const { date } = req.query; // Get date in YYYY/MM or YYYY-MM format

        // Validate date format (YYYY/MM or YYYY-MM)
        if (!date || !/^\d{4}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY/MM or YYYY-MM." });
        }

        // Fetch Organization Data
        const { organizationExists, allInvoice, allCustomer } = await dataExist(organizationId);
        if (!organizationExists) return res.status(404).json({ message: "Organization not found!" });

        // Get organization's time zone
        const orgTimeZone = organizationExists.timeZoneExp || "UTC";

        // Extract Year and Month
        const [year, month] = date.split(/[-/]/).map(Number); // Split date on "-" or "/"

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

        // Filter customers within the date range (using organization time zone)
        const filteredCustomers = allCustomer.filter(customer => {
            const customersDate = moment.tz(customer.createdDateTime, orgTimeZone);
            return customersDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered Invoices:", filteredInvoices);
        console.log("Filtered Customers:", filteredCustomers);

        //total customers
        const totalCustomers = allCustomer.length;

        // New Customers: Count of customers created in the selected range
        const newCustomerCount = filteredCustomers.length;

        // Active customers
        const activeCustomers = filteredCustomers.filter(customer => customer.status === "Active").length;

        // Get Previous Month Active Customers
        const prevMonthStart = moment(startDate).subtract(1, "month").startOf("month");
        const prevMonthEnd = moment(startDate).subtract(1, "month").endOf("month");

        const prevMonthActiveCustomers = allCustomer.filter(customer => {
            const customerDate = moment.tz(customer.createdDateTime, orgTimeZone);
            return (
                customerDate.isBetween(prevMonthStart, prevMonthEnd, null, "[]") &&
                customer.status === "Active"
            );
        }).length;
        console.log("prevMonthActiveCustomers:",prevMonthActiveCustomers);

        // Customer retention rate
        const customerRetentionRate = prevMonthActiveCustomers > 0
            ? ((prevMonthActiveCustomers - newCustomerCount) / prevMonthActiveCustomers) * 100
            : 0;

        // Customer churn rate
        const customerChurnRate = prevMonthActiveCustomers > 0
            ? ((prevMonthActiveCustomers - activeCustomers) / prevMonthActiveCustomers) * 100
            : 0;

        console.log("Final Calculations:", { totalCustomers, newCustomerCount, activeCustomers, customerRetentionRate, customerChurnRate });

        // Response JSON
        res.json({
            totalCustomers,
            newCustomer: newCustomerCount,
            activeCustomers,
            customerRetentionRate,
            customerChurnRate,
        });

    } catch (error) {
        console.error("Error fetching overview data:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};




// Top Selling Product
exports.getTopCustomers = async (req, res) => {
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
        const [year, month] = date.split(/[-/]/).map(Number); // Split date on "-" or "/"

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

        // 🔹 NEW: Find top 7 customers by total purchase amount
        let customerSales = {};

        filteredInvoices.forEach(inv => {
            if (inv.customerId) {
                const customerId = inv.customerId._id.toString(); // Convert ObjectId to string
                const customerName = inv.customerId.customerDisplayName || "Undefined";

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
            .slice(0, 5); // Get top 7 customers

        console.log("Top 5 Customers:", topCustomers);

        // Response JSON
        res.json({
            topCustomers: topCustomers
        });

    } catch (error) {
        console.error("Error fetching top customers:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};



// Customer Retention Over Time
exports.getCustomerRetentionOverTime = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date } = req.query; // Get date in YYYY/MM or YYYY-MM format

        // Validate date format (YYYY/MM or YYYY-MM)
        if (!date || !/^\d{4}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY/MM or YYYY-MM." });
        }

        // Fetch Organization Data
        const { organizationExists, allCustomer } = await dataExist(organizationId);
        if (!organizationExists) return res.status(404).json({ message: "Organization not found!" });

        // Get organization's time zone
        const orgTimeZone = organizationExists.timeZoneExp || "UTC";

        // Extract Year and Month
        const [year, month] = date.split(/[-/]/).map(Number); // Split date on "-" or "/"

        // Ensure valid year and month
        if (!year || !month || month < 1 || month > 12) {
            return res.status(400).json({ message: "Invalid year or month in date." });
        }

        // Set start and end date for the month
        const startDate = moment.tz(`${year}-${month}-01`, orgTimeZone).startOf("month");
        const endDate = moment(startDate).endOf("month");

        console.log("Requested Date Range:", startDate.format(), endDate.format());

        // Initialize daily retention tracking
        let dailyRetention = {};
        let currentDate = startDate.clone();
        while (currentDate.isBefore(endDate) || currentDate.isSame(endDate, "day")) {
            dailyRetention[currentDate.format("YYYY-MM-DD")] = 0;
            currentDate.add(1, "day");
        }

        // Get Previous Month Active Customers
        const prevMonthStart = moment(startDate).subtract(1, "month").startOf("month");
        const prevMonthEnd = moment(startDate).subtract(1, "month").endOf("month");

        const prevMonthActiveCustomers = allCustomer.filter(customer => {
            const customerDate = moment.tz(customer.createdDateTime, orgTimeZone);
            return (
                customerDate.isBetween(prevMonthStart, prevMonthEnd, null, "[]") &&
                customer.status === "Active"
            );
        }).length;

        console.log("Previous Month Active Customers:", prevMonthActiveCustomers);

        // Group new customers by day
        let newCustomersByDay = {};
        allCustomer.forEach(customer => {
            const customerDate = moment.tz(customer.createdDateTime, orgTimeZone).format("YYYY-MM-DD");
            if (dailyRetention[customerDate] !== undefined) {
                newCustomersByDay[customerDate] = (newCustomersByDay[customerDate] || 0) + 1;
            }
        });

        console.log("New Customers By Day:", newCustomersByDay);

        // Calculate daily retention rate
        let remainingCustomers = prevMonthActiveCustomers; // Start with last month's active customers
        Object.keys(dailyRetention).forEach(date => {
            const newCustomersToday = newCustomersByDay[date] || 0;
            const retainedCustomers = remainingCustomers - newCustomersToday;

            dailyRetention[date] =
                remainingCustomers > 0
                    ? (retainedCustomers / remainingCustomers) * 100
                    : 0;

            remainingCustomers = retainedCustomers; // Update remaining customers for the next day
        });

        console.log("Daily Retention:", dailyRetention);

        // Convert to array format for a cleaner response
        const dailyRetentionArray = Object.keys(dailyRetention).map(date => ({
            date,
            retentionRate: dailyRetention[date]
        }));

        // Response JSON
        res.json({
            dailyRetention: dailyRetentionArray
        });

    } catch (error) {
        console.error("Error fetching customer retention over time:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};



// Get Average Order Value (AOV)
exports.getAverageOrderValue = async (req, res) => {
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
        const [year, month] = date.split(/[-/]/).map(Number); // Split date on "-" or "/"

        // Ensure valid year and month
        if (!year || !month || month < 1 || month > 12) {
            return res.status(400).json({ message: "Invalid year or month in date." });
        }

        // Set start and end date for the month
        const startDate = moment.tz(`${year}-${month}-01`, orgTimeZone).startOf("month");
        const endDate = moment(startDate).endOf("month");

        console.log("Requested Date Range:", startDate.format(), endDate.format());

        // Filter invoices within the date range
        const filteredInvoices = allInvoice.filter(inv => {
            const invoiceDate = moment.tz(inv.createdDateTime, orgTimeZone);
            return invoiceDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered Invoices:", filteredInvoices);

        // Calculate total sales (sum of all invoice amounts) and count orders
        const totalSales = filteredInvoices.reduce((sum, inv) => sum + inv.saleAmount, 0);
        const totalOrders = filteredInvoices.length;

        // Formula for Average Order Value (AOV)
        // 𝐴𝑂𝑉 = Total Revenue in Period/Total Number of Orders in Period

        // Calculate Average Order Value
        const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

        console.log("Total Sales:", totalSales);
        console.log("Total Orders:", totalOrders);
        console.log("Average Order Value:", averageOrderValue);

        // Response JSON
        res.json({
            averageOrderValue
        });

    } catch (error) {
        console.error("Error fetching average order value:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};





