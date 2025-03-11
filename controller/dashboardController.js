const PurchaseOrder = require("../database/model/purchaseOrder");
const PurchaseBill = require("../database/model/bills");
const PaymentMade = require("../database/model/paymentMade");
const DebitNote = require("../database/model/debitNote");
const Organization = require("../database/model/organization");

const moment = require("moment-timezone");
const mongoose = require('mongoose');


const dataExist = async ( organizationId ) => {    
    const [organizationExists, allOrder, allBill, allPaymentMade, allDebitNote ] = await Promise.all([
      Organization.findOne({ organizationId },{ timeZoneExp: 1, dateFormatExp: 1, dateSplit: 1, organizationCountry: 1 })
      .lean(),
      PurchaseOrder.find({ organizationId }, {_id: 1, supplierId: 1, purchaseOrder: 1, purchaseOrderDate: 1, items: 1, grandTotal: 1, totalTaxAmount: 1, status: 1, createdDateTime: 1 })
      .populate('items.itemId', 'itemName') 
      .populate('supplierId', 'supplierDisplayName')    
      .lean(),
      PurchaseBill.find({ organizationId }, {_id: 1, supplierId: 1, billNumber: 1, billDate: 1, items: 1, paidStatus: 1, paidAmount: 1, purchaseAmount: 1, createdDateTime: 1 })
      .populate('items.itemId', 'itemName') 
      .populate('supplierId', 'supplierDisplayName')    
      .lean(),
      PaymentMade.find({ organizationId }, {_id: 1, supplierId: 1, paymentMade: 1, paymentDate: 1, unpaidBills: 1, total: 1, paymentMode: 1, createdDateTime: 1 })
      .populate('supplierId', 'supplierDisplayName')    
      .lean(),
      DebitNote.find({ organizationId }, {_id: 1, supplierId: 1, items: 1, debitNote: 1, supplierDebitDate: 1, grandTotal: 1, totalTaxAmount: 1, createdDateTime: 1 })
      .populate('items.itemId', 'itemName') 
      .populate('supplierId', 'supplierDisplayName')    
      .lean()
    ]);
    return { organizationExists, allOrder, allBill, allPaymentMade, allDebitNote };
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
        const { organizationExists, allOrder, allBill, allDebitNote } = await dataExist(organizationId);
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

        // Filter orders within the date range (using organization time zone)
        const filteredOrder = allOrder.filter(order => {
            const orderDate = moment.tz(order.createdDateTime, orgTimeZone);
            return orderDate.isBetween(startDate, endDate, null, "[]");
        });

        // Filter bills within the date range (using organization time zone)
        const filteredBills = allBill.filter(bill => {
            const billDate = moment.tz(bill.createdDateTime, orgTimeZone);
            return billDate.isBetween(startDate, endDate, null, "[]");
        });

        // Filter debit note within the date range (using organization time zone)
        const filteredDebitNote = allDebitNote.filter(dn => {
            const DNDate = moment.tz(dn.createdDateTime, orgTimeZone);
            return DNDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered Orders:", filteredOrder);
        console.log("Filtered Bills:", filteredBills);
        console.log("Filtered Debit Notes:", filteredDebitNote);

        // Total Revenue: Sum of paidAmount where paidStatus is "Completed"
        const totalRevenue = filteredBills
            .filter(bill => bill.paidStatus === "Completed")
            .reduce((sum, bill) => sum + (parseFloat(bill.paidAmount) || 0), 0);
        
        // total purchase order count
        const totalPurchaseOrder = filteredOrder.length;

        // Calculate total items purchased
        const totalItemPurchased = filteredBills.reduce((total, bill) => {
            return total + bill.items.reduce((sum, item) => sum + (item.itemQuantity || 0), 0);
        }, 0);

        // total payment made count
        const totalPaymentMade = filteredBills.filter(payment => payment.paidAmount > 0).length;

        // total shipments
        const totalShipments = filteredBills.length;

        console.log("Final Calculations:", { totalRevenue, totalPurchaseOrder, totalItemPurchased, totalPaymentMade, totalShipments });

        // Response JSON
        res.json({
            totalRevenue,
            totalPurchaseOrder,
            totalItemPurchased,
            totalPaymentMade,
            totalShipments,
        });

    } catch (error) {
        console.error("Error fetching overview data:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};



// Purchase Over Time
exports.getPurchaseOverTime = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date } = req.query; // Get date in YYYY/MM or YYYY-MM format

        // Validate date format (YYYY/MM or YYYY-MM)
        if (!date || !/^\d{4}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY/MM or YYYY-MM." });
        }

        // Fetch Organization Data
        const { organizationExists, allBill } = await dataExist(organizationId);
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
        let dailyPurchase = {};

        // Loop through the days of the month
        let currentDate = startDate.clone();
        while (currentDate.isBefore(endDate) || currentDate.isSame(endDate, "day")) {
            dailyPurchase[currentDate.format("YYYY-MM-DD")] = 0;
            currentDate.add(1, "day");
        }

        // Filter bills within the date range (using organization time zone)
        allBill.forEach(bill => {
            const billDate = moment.tz(bill.createdDateTime, orgTimeZone).format("YYYY-MM-DD");
            if (dailyPurchase[billDate] !== undefined) {
                dailyPurchase[billDate] += parseFloat(bill.purchaseAmount) || 0;
            }
        });

        console.log("Daily Purchase Breakdown:", dailyPurchase);

        // Convert daily purchase object to an array for better response format
        const dailyPurchaseArray = Object.keys(dailyPurchase).map(date => ({
            date,
            totalPurchase: dailyPurchase[date]
        }));

        // Total Purchase: Sum of totalAmount from bill filtered for the selected range
        const totalPurchase = dailyPurchaseArray.reduce((sum, day) => sum + day.totalPurchase, 0);

        // Response JSON
        res.json({
            totalPurchase,
            dailyPurchase: dailyPurchaseArray
        });

    } catch (error) {
        console.error("Error fetching purchase over time data:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};




// Top Product by spend
exports.getTopProductsBySpend = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date } = req.query; // Get date in YYYY/MM or YYYY-MM format

        // Validate date format (YYYY/MM or YYYY-MM)
        if (!date || !/^\d{4}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY/MM or YYYY-MM." });
        }

        // Fetch Organization Data
        const { organizationExists, allBill } = await dataExist(organizationId);
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

        // Filter bills within the date range (using organization time zone)
        const filteredBills = allBill.filter(bill => {
            const billDate = moment.tz(bill.createdDateTime, orgTimeZone);
            return billDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered Bills:", filteredBills);

        // Track total spend per product
        let productSpend = {};

        filteredBills.forEach(bill => {
            bill.items.forEach(item => {
                if (item.itemId) {
                    const itemId = item.itemId._id.toString();
                    const itemName = item.itemId.itemName || "Undefined";
                    const itemTotalAmount = (item.itemCostPrice || 0) * (item.itemQuantity || 0);

                    if (!productSpend[itemId]) {
                        productSpend[itemId] = {
                            itemId,
                            itemName,
                            totalSpend: 0
                        };
                    }

                    // Accumulate total spend
                    productSpend[itemId].totalSpend += itemTotalAmount;
                }
            });
        });

        // Convert object to an array & sort by total spend
        const sortedTopProducts = Object.values(productSpend)
            .sort((a, b) => b.totalSpend - a.totalSpend) // Sort by spend descending
            .slice(0, 6); // Get top 6 products

        console.log("Top 6 products:", sortedTopProducts);

        // Response JSON
        res.json({
            topProducts: sortedTopProducts
        });

    } catch (error) {
        console.error("Error fetching top products by spend:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};



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
        const { organizationExists, allOrder, allBill, allPaymentMade, allDebitNote } = await dataExist(organizationId);
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

        // Filter orders within the date range (using organization time zone)
        const filteredOrder = allOrder.filter(order => {
            const orderDate = moment.tz(order.createdDateTime, orgTimeZone);
            return orderDate.isBetween(startDate, endDate, null, "[]");
        });

        // Filter bills within the date range (using organization time zone)
        const filteredBills = allBill.filter(bill => {
            const billDate = moment.tz(bill.createdDateTime, orgTimeZone);
            return billDate.isBetween(startDate, endDate, null, "[]");
        });

        // Filter payment made within the date range (using organization time zone)
        const filteredPayment = allPaymentMade.filter(payment => {
            const paymentDate = moment.tz(payment.createdDateTime, orgTimeZone);
            return paymentDate.isBetween(startDate, endDate, null, "[]");
        });

        // Filter debit note within the date range (using organization time zone)
        const filteredDebitNote = allDebitNote.filter(dn => {
            const DNDate = moment.tz(dn.createdDateTime, orgTimeZone);
            return DNDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered Orders:", filteredOrder);
        console.log("Filtered Bills:", filteredBills);
        console.log("Filtered Payment Made:", filteredPayment);
        console.log("Filtered Debit Notes:", filteredDebitNote);


        // total purchase order 
        const recentOrders = [];
        filteredOrder.forEach(data => {
            recentOrders.push({
                orderId: data._id.toString(),
                purchaseOrder: data.purchaseOrder,
                purchaseOrderDate: data.purchaseOrderDate,
                supplierName: data.supplierId?.supplierDisplayName || "Unknown",
                status: data.status,
                totalAmount: (data.grandTotal - data.totalTaxAmount) || 0,
            });
        });

        // total purchase bills 
        const recentBills = [];
        filteredBills.forEach(data => {
            recentBills.push({
                billId: data._id.toString(),
                billNumber: data.billNumber,
                billDate: data.billDate,
                supplierName: data.supplierId?.supplierDisplayName || "Unknown",
                paidStatus: data.paidStatus,
                totalAmount: data.purchaseAmount,
            });
        });

        // total payment made 
        const recentPaymentMade = [];
        filteredPayment.forEach(data => {
            recentPaymentMade.push({
                paymentId: data._id.toString(),
                paymentMade: data.paymentMade,
                paymentDate: data.paymentDate,
                supplierName: data.supplierId?.supplierDisplayName || "Unknown",
                paymentMode: data.paymentMode,
                totalAmount: data.total,
            });
        });

        // total debit note 
        const recentDebitNotes = [];
        filteredDebitNote.forEach(data => {
            recentDebitNotes.push({
                debitNoteId: data._id.toString(),
                debitNote: data.debitNote,
                supplierDebitDate: data.supplierDebitDate,
                supplierName: data.supplierId?.supplierDisplayName || "Unknown",
                totalAmount: (data.grandTotal - data.totalTaxAmount) || 0,
            });
        });
        
        console.log("Final Calculations:", { recentOrders, recentBills, recentPaymentMade, recentDebitNotes, });

        // Response JSON
        res.json({
            recentOrders,
            recentBills,
            recentPaymentMade,
            recentDebitNotes,
        });

    } catch (error) {
        console.error("Error fetching recent transactions data:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};
