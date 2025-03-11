const SalesQuote = require("../database/model/salesQuotes");
const SalesOrder = require("../database/model/salesOrder");
const SalesInvoice = require("../database/model/salesInvoice");
const CreditNote = require("../database/model/creditNote");
const Organization = require("../database/model/organization");

const moment = require("moment-timezone");
const mongoose = require('mongoose');



const dataExist = async ( organizationId ) => {    
    const [organizationExists, allQuote, allOrder, allInvoice, allCreditNote ] = await Promise.all([
      Organization.findOne({ organizationId },{ timeZoneExp: 1, dateFormatExp: 1, dateSplit: 1, organizationCountry: 1 })
      .lean(),
      SalesQuote.find({ organizationId }, {_id: 1, customerId: 1, salesQuotes: 1, salesQuoteDate: 1, items: 1, totalAmount: 1, totalTax: 1, status: 1, createdDateTime: 1 })
      .populate('items.itemId', 'itemName') 
      .populate('customerId', 'customerDisplayName')    
      .lean(),
      SalesOrder.find({ organizationId }, {_id: 1, customerId: 1, salesOrderDate: 1, salesOrder: 1, items: 1, totalAmount: 1, totalTax: 1, status: 1, createdDateTime: 1 })
      .populate('items.itemId', 'itemName') 
      .populate('customerId', 'customerDisplayName')    
      .lean(),
      SalesInvoice.find({ organizationId }, {_id: 1, customerId: 1, salesInvoice: 1, salesInvoiceDate: 1, items: 1, paidStatus: 1, paidAmount: 1, saleAmount: 1, totalAmount: 1, createdDateTime: 1 })
      .populate('items.itemId', 'itemName') 
      .populate('customerId', 'customerDisplayName')    
      .lean(),
      CreditNote.find({ organizationId }, {_id: 1, customerId: 1, items: 1, creditNote: 1, customerCreditDate: 1, totalAmount: 1, totalTax: 1, createdDateTime: 1 })
      .populate('items.itemId', 'itemName') 
      .populate('customerId', 'customerDisplayName')    
      .lean()
    ]);
    return { organizationExists, allQuote, allOrder, allInvoice, allCreditNote };
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
        const { organizationExists, allQuote, allOrder, allInvoice, allCreditNote } = await dataExist(organizationId);
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

        // Filter quote within the date range (using organization time zone)
        const filteredQuote = allQuote.filter(quote => {
            const quoteDate = moment.tz(quote.createdDateTime, orgTimeZone);
            return quoteDate.isBetween(startDate, endDate, null, "[]");
        });

        // Filter orders within the date range (using organization time zone)
        const filteredOrder = allOrder.filter(order => {
            const orderDate = moment.tz(order.createdDateTime, orgTimeZone);
            return orderDate.isBetween(startDate, endDate, null, "[]");
        });

        // Filter credit note within the date range (using organization time zone)
        const filteredCreditNote = allCreditNote.filter(cn => {
            const CNDate = moment.tz(cn.createdDateTime, orgTimeZone);
            return CNDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered Invoices:", filteredInvoices);
        console.log("Filtered Quotes:", filteredQuote);
        console.log("Filtered Orders:", filteredOrder);
        console.log("Filtered Credit Notes:", filteredCreditNote);

        // Total Revenue: Sum of paidAmount where paidStatus is "Completed"
        const totalRevenue = filteredInvoices
            .filter(inv => inv.paidStatus === "Completed")
            .reduce((sum, inv) => sum + (parseFloat(inv.paidAmount) || 0), 0);
        
        // total sales quote count
        const totalSalesQuoteCount = filteredQuote.length;

        // total sales order count
        const totalSalesOrderCount = filteredOrder.length;

        // total sales invoice count
        const totalInvoiceCount = filteredInvoices.length;

        // total credit note count
        const totalCreditNoteCount = filteredCreditNote.length;
        
        console.log("Final Calculations:", { totalRevenue, totalSalesQuoteCount, totalSalesOrderCount, totalInvoiceCount, totalCreditNoteCount, });

        // Response JSON
        res.json({
            totalRevenue,
            totalSalesQuoteCount,
            totalSalesOrderCount,
            totalInvoiceCount,
            totalCreditNoteCount,
        });

    } catch (error) {
        console.error("Error fetching overview data:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};



// Sales over time - already used main dashboard 



// Top sales order
exports.getTopSalesOrder = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date } = req.query; // Get date in YYYY/MM or YYYY-MM format

        // Validate date format (YYYY/MM or YYYY-MM)
        if (!date || !/^\d{4}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY/MM or YYYY-MM." });
        }

        // Fetch Organization Data
        const { organizationExists, allOrder } = await dataExist(organizationId);
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

        // Filter orders within the date range (using organization time zone)
        const filteredOrders = allOrder.filter(order => {
            const orderDate = moment.tz(order.createdDateTime, orgTimeZone);
            return orderDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered Orders:", filteredOrders.length);

        // Track top sales orders
        let topOrders = [];

        filteredOrders.forEach(order => {
            if (!order.totalAmount) return; // Skip orders with no total amount

            // Extract item names from the order
            const itemNames = order.items
                .map(item => item.itemId?.itemName || "Unknown Item")
                .join(", "); // Join multiple item names with a comma

            topOrders.push({
                orderId: order._id.toString(),
                customerName: order.customerId?.customerDisplayName || "Unknown",
                itemName: itemNames,
                totalAmount: (order.totalAmount - order.totalTax) || 0,
            });
        });

        // Sort by totalAmount (highest to lowest) and get top 6
        const sortedTopOrders = topOrders
            .sort((a, b) => b.totalAmount - a.totalAmount)
            .slice(0, 6);

        console.log("Top 6 Sales Orders:", sortedTopOrders);

        // Response JSON
        res.json({
            topOrders: sortedTopOrders
        });

    } catch (error) {
        console.error("Error fetching top sales order:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};



// Top sales by customer - already used customer dashboard 



// recent transactions 
exports.getRecentTransactions = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date } = req.query; // Get date in YYYY/MM or YYYY-MM format

        // Validate date format (YYYY/MM or YYYY-MM)
        if (!date || !/^\d{4}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY/MM or YYYY-MM." });
        }

        // Fetch Organization Data
        const { organizationExists, allQuote, allOrder, allInvoice, allCreditNote } = await dataExist(organizationId);
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

        // Filter quote within the date range (using organization time zone)
        const filteredQuote = allQuote.filter(quote => {
            const quoteDate = moment.tz(quote.createdDateTime, orgTimeZone);
            return quoteDate.isBetween(startDate, endDate, null, "[]");
        });

        // Filter orders within the date range (using organization time zone)
        const filteredOrder = allOrder.filter(order => {
            const orderDate = moment.tz(order.createdDateTime, orgTimeZone);
            return orderDate.isBetween(startDate, endDate, null, "[]");
        });

        // Filter credit note within the date range (using organization time zone)
        const filteredCreditNote = allCreditNote.filter(cn => {
            const CNDate = moment.tz(cn.createdDateTime, orgTimeZone);
            return CNDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered Invoices:", filteredInvoices);
        console.log("Filtered Quotes:", filteredQuote);
        console.log("Filtered Orders:", filteredOrder);
        console.log("Filtered Credit Notes:", filteredCreditNote);
        
        // total sales quote count
        const recentQuotes = [];
        filteredQuote.forEach(data => {
            recentQuotes.push({
                quoteId: data._id.toString(),
                salesQuotes: data.salesQuotes,
                salesQuoteDate: data.salesQuoteDate,
                customerName: data.customerId?.customerDisplayName || "Unknown",
                status: data.status,
                totalAmount: (data.totalAmount - data.totalTax) || 0,
            });
        });

        // total sales order count
        const recentOrders = [];
        filteredOrder.forEach(data => {
            recentOrders.push({
                orderId: data._id.toString(),
                salesOrder: data.salesOrder,
                salesOrderDate: data.salesOrderDate,
                customerName: data.customerId?.customerDisplayName || "Unknown",
                status: data.status,
                totalAmount: (data.totalAmount - data.totalTax) || 0,
            });
        });

        // total sales invoice count
        const recentInvoices = [];
        filteredInvoices.forEach(data => {
            recentInvoices.push({
                invoiceId: data._id.toString(),
                salesInvoice: data.salesInvoice,
                salesInvoiceDate: data.salesInvoiceDate,
                customerName: data.customerId?.customerDisplayName || "Unknown",
                paidStatus: data.paidStatus,
                totalAmount: data.saleAmount || 0,
            });
        });

        // total credit note count
        const recentCreditNotes = [];
        filteredCreditNote.forEach(data => {
            recentCreditNotes.push({
                creditNoteId: data._id.toString(),
                creditNote: data.creditNote,
                customerCreditDate: data.customerCreditDate,
                customerName: data.customerId?.customerDisplayName || "Unknown",
                totalAmount: (data.totalAmount - data.totalTax) || 0,
            });
        });
        
        console.log("Final Calculations:", { recentInvoices, recentOrders, recentQuotes, recentCreditNotes, });

        // Response JSON
        res.json({
            recentInvoices,
            recentOrders,
            recentQuotes,
            recentCreditNotes,
        });

    } catch (error) {
        console.error("Error fetching recent transactions data:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};



