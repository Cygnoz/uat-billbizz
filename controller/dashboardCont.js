const Supplier = require("../database/model/supplier");
const Bills = require("../database/model/bills");
const PurchaseOrder = require("../database/model/purchaseOrder");
const Item = require("../database/model/item");
const ItemTrack = require("../database/model/itemTrack");
const Organization = require("../database/model/organization");
const moment = require("moment-timezone");
const mongoose = require('mongoose');


const dataExist = async ( organizationId ) => {    
    const [organizationExists, allBills, allSupplier, allPurchaseOrder ] = await Promise.all([
      Organization.findOne({ organizationId },{ timeZoneExp: 1, dateFormatExp: 1, dateSplit: 1, organizationCountry: 1 })
      .lean(),
      Bills.find({ organizationId }, {_id: 1, supplierId: 1, items: 1, paidStatus: 1, paidAmount: 1, grandTotal: 1, purchaseAmount: 1, balanceAmount: 1, billDate: 1, expectedShipmentDate: 1, createdDateTime: 1 })
      .populate('items.itemId', 'itemName') 
      .populate('supplierId', 'supplierDisplayName')    
      .lean(),
      Supplier.find({ organizationId }, {_id: 1, supplierDisplayName: 1, status: 1, createdDateTime: 1 })
      .lean(),
      PurchaseOrder.find({ organizationId }, {_id: 1, supplierId: 1, items: 1, grandTotal: 1, totalTaxAmount: 1, createdDateTime: 1 })
      .populate('items.itemId', 'itemName') 
      .populate('supplierId', 'supplierDisplayName')    
      .lean(),
    ]);
    return { organizationExists, allBills, allSupplier, allPurchaseOrder };
};



//Xs Item Exist
const xsItemDataExists = async (organizationId) => {
  const [newItems] = await Promise.all([
    Item.find( { organizationId }, { _id: 1, itemName: 1, itemImage: 1, costPrice:1, categories: 1, createdDateTime: 1 } )
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
        const { organizationExists, allBills, allSupplier } = await dataExist(organizationId);
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

        // Filter suppliers within the date range (using organization time zone)
        const filteredSuppliers = allSupplier.filter(supplier => {
            const suppliersDate = moment.tz(supplier.createdDateTime, orgTimeZone);
            return suppliersDate.isBetween(startDate, endDate, null, "[]");
        });

        // Filter bills within the date range (using organization time zone)
        const filteredBills = allBills.filter(bill => {
            const billDate = moment.tz(bill.createdDateTime, orgTimeZone);
            return billDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered suppliers:", filteredSuppliers);
        console.log("Filtered bills:", filteredBills);

        // Active suppliers
        const activeSupplier = filteredSuppliers.filter(supplier => supplier.status === "Active").length;

        //Total Spend On Supplier
        const totalSpendOnSupplier = filteredBills.reduce(
            (sum, bill) => sum + (bill.paidAmount || 0), 0
        )

        // Pending Supplier Payments
        const pendingSupplierPayments = filteredBills.reduce(
            (sum, bill) => sum + (bill.balanceAmount || 0), 0
        )

        // total Shipments
        const totalShipments = filteredBills.filter(bill => bill).length;

        console.log("Final Calculations:", { activeSupplier, totalSpendOnSupplier, pendingSupplierPayments, totalShipments });

        // Response JSON
        res.json({
            activeSupplier,
            totalSpendOnSupplier,
            pendingSupplierPayments,
            totalShipments
        });

    } catch (error) {
        console.error("Error fetching overview data:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};



// Top Product By Supplier
exports.getTopProductsBySupplier = async (req, res) => {
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
      const [year, month] = date.split(/[-/]/).map(Number); // Split date on "-" or "/"

      // Ensure valid year and month
      if (!year || !month || month < 1 || month > 12) {
          return res.status(400).json({ message: "Invalid year or month in date." });
      }

      // Set start and end date for the month
      const startDate = moment.tz(`${year}-${month}-01`, orgTimeZone).startOf("month");
      const endDate = moment(startDate).endOf("month");

      console.log("Requested Date Range:", startDate.format(), endDate.format());

      // Fetch enriched item data (includes itemImage and currentStock)
      const { enrichedItems } = await xsItemDataExists(organizationId);

      // Convert enrichedItems array to a Map for quick lookup
      const itemMap = new Map(enrichedItems.map(item => [item._id.toString(), item]));

      // Filter bills within the date range (using organization time zone)
      const filteredBills = allBills.filter(bill => {
        const billDate = moment.tz(bill.createdDateTime, orgTimeZone);
        return billDate.isBetween(startDate, endDate, null, "[]");
      });

      console.log("Filtered bills Count:", filteredBills.length);

      // Track top products
      let topProducts = {};

      filteredBills.forEach(bill => {
        bill.items.forEach(item => {
              if (item.itemId) {
                  const itemId = item.itemId._id.toString();
                  const itemName = item.itemId.itemName || "Undefined";
                  const itemQuantity = item.itemQuantity || 0; 
                  const totalAmount = bill.purchaseAmount || 0;
                  const supplierName = bill.supplierId.supplierDisplayName || "Undefined"; 

                  // Get item details from enrichedItems
                  const enrichedItem = itemMap.get(itemId);

                  // Check if enriched item exists
                  const itemImage = enrichedItem?.itemImage || null;

                  if (!topProducts[itemId]) {
                      topProducts[itemId] = {
                          itemId,
                          itemName,
                          totalSold: 0,
                          totalAmount: 0,
                          supplierName,
                          itemImage, 
                      };
                  }

                  // Accumulate quantity and total amount
                  topProducts[itemId].totalSold += itemQuantity;
                  topProducts[itemId].totalAmount += totalAmount;
              }
          });
      });

      // Convert object to an array & sort by total quantity sold
      const sortedTopProducts = Object.values(topProducts)
          .sort((a, b) => b.totalSold - a.totalSold) // Sort by most sold items
          .slice(0, 5); // Get top 5 products

      console.log("Top 5 Products:", sortedTopProducts);

      // Response JSON
      res.json({
          topProductsBySupplier: sortedTopProducts
      });

  } catch (error) {
      console.error("Error fetching top products:", error);
      res.status(500).json({ message: "Internal server error." });
  }
};



// Average delivery time by supplier
exports.getAverageDeliveryTime = async (req, res) => {
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
        const [year, month] = date.split(/[-/]/).map(Number); // Split date on "-" or "/"

        // Ensure valid year and month
        if (!year || !month || month < 1 || month > 12) {
            return res.status(400).json({ message: "Invalid year or month in date." });
        }

        // Set start and end date for the month
        const startDate = moment.tz(`${year}-${month}-01`, orgTimeZone).startOf("month");
        const endDate = moment(startDate).endOf("month");

        console.log("Requested Date Range:", startDate.format(), endDate.format());

        // Filter bills within the date range (using organization time zone)
        const filteredBills = allBills.filter(bill => {
            const billDate = moment.tz(bill.createdDateTime, orgTimeZone);
            return billDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered bills:", filteredBills);

        // Calculate delivery times by supplier
        const deliveryTimesBySupplier = {};

        filteredBills.forEach(bill => {
            if (!bill.billDate || !bill.expectedShipmentDate) return; // Skip if dates are missing

            const billDate = moment(bill.billDate, "YYYY-MM-DD");
            const expectedShipmentDate = moment(bill.expectedShipmentDate, "YYYY-MM-DD");

            if (!billDate.isValid() || !expectedShipmentDate.isValid()) return; // Skip invalid dates

            const deliveryTime = expectedShipmentDate.diff(billDate, "days"); // Difference in days
            const supplierId = bill.supplierId?._id?.toString(); // Ensure valid supplierId

            if (supplierId) {
                if (!deliveryTimesBySupplier[supplierId]) {
                    deliveryTimesBySupplier[supplierId] = { totalDays: 0, count: 0, supplierName: bill.supplierId?.supplierDisplayName };
                }
                deliveryTimesBySupplier[supplierId].totalDays += deliveryTime;
                deliveryTimesBySupplier[supplierId].count += 1;
            }
        });

        // Calculate average delivery time per supplier
        const avgDeliveryTimes = Object.entries(deliveryTimesBySupplier).map(([supplierId, data]) => ({
            supplierId,
            supplierName: data.supplierName,
            avgDeliveryTime: data.count > 0 ? data.totalDays / data.count : 0
        }));

        // Sort suppliers by shortest average delivery time & get top 6
        const top6Suppliers = avgDeliveryTimes.sort(
            (a, b) => a.avgDeliveryTime - b.avgDeliveryTime
        ).slice(0, 6);

        console.log("Top 6 Suppliers with Shortest Delivery Times:", top6Suppliers);

        // Response JSON
        res.json({ averageDeliveryTime: top6Suppliers });

    } catch (error) {
        console.error("Error fetching average delivery time:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};



// Top supplier by spend
exports.getTopSupplierBySpend = async (req, res) => {
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
        const [year, month] = date.split(/[-/]/).map(Number); // Split date on "-" or "/"

        // Ensure valid year and month
        if (!year || !month || month < 1 || month > 12) {
            return res.status(400).json({ message: "Invalid year or month in date." });
        }

        // Set start and end date for the month
        const startDate = moment.tz(`${year}-${month}-01`, orgTimeZone).startOf("month");
        const endDate = moment(startDate).endOf("month");

        console.log("Requested Date Range:", startDate.format(), endDate.format());

        // Filter bills within the date range (using organization time zone)
        const filteredBills = allBills.filter(bill => {
            const billDate = moment.tz(bill.createdDateTime, orgTimeZone);
            return billDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered bills:", filteredBills);

        // Count the number of times each supplier appears in bills
        const supplierSpendCount = {};

        filteredBills.forEach(bill => {
            const supplierId = bill.supplierId?._id?.toString();
            if (!supplierId) return; // Skip if no supplierId

            if (!supplierSpendCount[supplierId]) {
                supplierSpendCount[supplierId] = { count: 0, supplierName: bill.supplierId?.supplierDisplayName };
            }
            supplierSpendCount[supplierId].count += 1; // Increment count
        });

        // Convert to array and sort by count (descending order)
        const topSuppliers = Object.entries(supplierSpendCount)
            .map(([supplierId, data]) => ({
                supplierId,
                supplierName: data.supplierName,
                totalSpend: data.count // Count of bills
            }))
            .sort((a, b) => b.totalSpend - a.totalSpend) // Sort highest count first
            .slice(0, 4); // Get top 4 suppliers

        console.log("Top 4 Suppliers by Spend Count:", topSuppliers);

        // Response JSON
        res.json({ topSuppliers });

    } catch (error) {
        console.error("Error fetching overview data:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};



// Top orders by supplier
exports.getTopOrdersBySupplier = async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const { date } = req.query; // Get date in YYYY/MM or YYYY-MM format

        // Validate date format (YYYY/MM or YYYY-MM)
        if (!date || !/^\d{4}[-/]\d{2}$/.test(date)) {
            return res.status(400).json({ message: "Invalid date format. Use YYYY/MM or YYYY-MM." });
        }

        // Fetch Organization Data
        const { organizationExists, allPurchaseOrder, allSupplier } = await dataExist(organizationId);
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

        // Filter purchase order within the date range (using organization time zone)
        const filteredPurchaseOrder = allPurchaseOrder.filter(order => {
            const orderDate = moment.tz(order.createdDateTime, orgTimeZone);
            return orderDate.isBetween(startDate, endDate, null, "[]");
        });

        console.log("Filtered purchase order:", filteredPurchaseOrder);

        // Count the number of orders for each supplier
        const supplierOrderCount = {};

        filteredPurchaseOrder.forEach(order => {
            const supplierId = order.supplierId?._id?.toString();
            if (!supplierId) return; // Skip if no supplierId

            if (!supplierOrderCount[supplierId]) {
                supplierOrderCount[supplierId] = { count: 0, supplierName: order.supplierId?.supplierDisplayName };
            }
            supplierOrderCount[supplierId].count += 1; // Increment count for each order
        });

        // Convert to array and sort by order count (descending order)
        const topSuppliers = Object.entries(supplierOrderCount)
            .map(([supplierId, data]) => ({
                supplierId,
                supplierName: data.supplierName,
                totalOrders: data.count // Count of orders per supplier
            }))
            .sort((a, b) => b.totalOrders - a.totalOrders) // Sort highest order count first
            .slice(0, 4); // Get top 4 suppliers

        console.log("Top 4 Suppliers by Purchase Orders:", topSuppliers);

        // Response JSON
        res.json({ topSuppliers });

    } catch (error) {
        console.error("Error fetching top orders by supplier:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};


