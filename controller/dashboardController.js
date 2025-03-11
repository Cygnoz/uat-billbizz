const SalesInvoice = require("../database/model/salesInvoice");
const Organization = require("../database/model/organization");
const Item = require("../database/model/item");
const ItemTrack = require("../database/model/itemTrack");
const moment = require("moment-timezone");
const mongoose = require('mongoose');


const dataExist = async ( organizationId ) => {    
    const [organizationExists, allInvoice, allItem ] = await Promise.all([
      Organization.findOne({ organizationId },{ timeZoneExp: 1, dateFormatExp: 1, dateSplit: 1, organizationCountry: 1 })
      .lean(),
      SalesInvoice.find({ organizationId }, {_id: 1, items: 1, totalAmount: 1, saleAmount: 1, createdDateTime: 1 })
      .populate('items.itemId', 'itemName')    
      .lean(),
      Item.find({ organizationId }, {_id: 1, itemName: 1, createdDateTime: 1 })
      .lean(),
    ]);
    return { organizationExists, allInvoice, allItem };
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
      const { date } = req.query; // Get date in YYYY/MM or YYYY-MM format

      // Validate date format (YYYY/MM or YYYY-MM)
      if (!date || !/^\d{4}[-/]\d{2}$/.test(date)) {
        return res.status(400).json({ message: "Invalid date format. Use YYYY/MM or YYYY-MM." });
      }

      // Fetch Organization Data
      const { organizationExists, allItem } = await dataExist(organizationId);
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

      // Total Inventory Value: Sum of (currentStock * costPrice)
      const filteredInventoryValue = enrichedItems.filter(item =>
          moment.tz(item.createdDateTime, orgTimeZone).isBetween(startDate, endDate, null, "[]")
      );

      console.log("Filtered Inventory Values:", filteredInventoryValue);

      // Corrected Total Inventory Value Calculation
      const totalInventoryValue = filteredInventoryValue.reduce(
          (sum, item) => sum + ((parseFloat(item.currentStock) || 0) * (parseFloat(item.costPrice) || 0)), 0
      );

      // Corrected Total Item Count Calculation
      const totalItemCount = filteredInventoryValue.reduce(
          (sum, item) => sum + (parseFloat(item.currentStock) || 0), 0
      );

      // Corrected Out-of-Stock Count Calculation
      const totalOutOfStock = filteredInventoryValue.filter(item => item.currentStock < 1).length;

      // Corrected New Item Count Calculation
      const newItemCount = allItem.filter(item =>
          moment.tz(item.createdDateTime, orgTimeZone).isBetween(startDate, endDate, null, "[]")
      ).length;

      console.log("Final Calculations:", { 
        totalInventoryValue,
        totalItemCount,
        totalOutOfStock,
        newItemCount,
        enrichedItems
      });

      // Response JSON
      res.json({
          totalInventoryValue,
          totalItemCount,
          totalOutOfStock,
          newItems: newItemCount,
      });

  } catch (error) {
      console.error("Error fetching overview data:", error);
      res.status(500).json({ message: "Internal server error." });
  }
};




// Top Selling Product
exports.getTopSellingProducts = async (req, res) => {
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

      // Fetch enriched item data (includes itemImage and currentStock)
      const { enrichedItems } = await xsItemDataExists(organizationId);

      // Convert enrichedItems array to a Map for quick lookup
      const itemMap = new Map(enrichedItems.map(item => [item._id.toString(), item]));

      // Filter invoices within the date range
      const filteredInvoices = allInvoice.filter(inv => {
          const invoiceDate = moment.tz(inv.createdDateTime, orgTimeZone);
          return invoiceDate.isBetween(startDate, endDate, null, "[]");
      });

      console.log("Filtered Invoices Count:", filteredInvoices.length);

      // Track top-selling products
      let topProducts = {};

      filteredInvoices.forEach(inv => {
          inv.items.forEach(item => {
              if (item.itemId) {
                  const itemId = item.itemId._id.toString();
                  const itemName = item.itemId.itemName || "Undefined";
                  const itemQuantity = item.quantity || 0; 
                  const totalAmount = inv.saleAmount || 0; 

                  // Get item details from enrichedItems
                  const enrichedItem = itemMap.get(itemId);

                  // Check if enriched item exists
                  const itemImage = enrichedItem?.itemImage || null;
                  const category = enrichedItem?.categories || null;
                  const currentStock = enrichedItem 
                      ? (enrichedItem.currentStock < 1 ? "Out of Stock" : "In Stock")
                      : "undefined";

                  if (!topProducts[itemId]) {
                      topProducts[itemId] = {
                          itemId,
                          itemName,
                          totalSold: 0,
                          totalAmount: 0,
                          category,
                          itemImage, 
                          currentStock 
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
          topProducts: sortedTopProducts
      });

  } catch (error) {
      console.error("Error fetching top-selling products:", error);
      res.status(500).json({ message: "Internal server error." });
  }
};

// // Top Selling Products & Top Selling Products by Category
// exports.getTopSellingProducts = async (req, res) => {
//   try {
//       const organizationId = req.user.organizationId;
//       const { date, filterType } = req.query; // Get date & filter type (month, year, day)

//       // Validate date input (YYYY-MM-DD or YYYY/MM/DD format)
//       if (!date || !/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(date)) {
//           return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD or YYYY/MM/DD." });
//       }

//       // Fetch Organization Data
//       const { organizationExists, allInvoice } = await dataExist(organizationId);
//       if (!organizationExists) return res.status(404).json({ message: "Organization not found!" });

//       // Get organization's time zone
//       const orgTimeZone = organizationExists.timeZoneExp || "UTC";

//       // Get the date range based on filterType
//       let startDate, endDate;
//       try {
//           ({ startDate, endDate } = getDateRange(filterType, date, orgTimeZone));
//       } catch (error) {
//           return res.status(400).json({ message: error.message });
//       }

//       console.log("Requested Date Range:", startDate.format(), endDate.format());

//       // Fetch enriched item data (includes itemImage, currentStock, categories)
//       const { enrichedItems } = await xsItemDataExists(organizationId);

//       // Filter invoices within the date range
//       const filteredInvoices = allInvoice.filter(inv => {
//           const invoiceDate = moment.tz(inv.createdDateTime, orgTimeZone);
//           return invoiceDate.isBetween(startDate, endDate, null, "[]");
//       });

//       console.log("Filtered Invoices Count:", filteredInvoices.length);

//       // Convert enrichedItems array to a Map for quick lookup
//       const itemMap = new Map(enrichedItems.map(item => [item._id.toString(), item]));

//       // Track top-selling products overall & by category
//       let topProducts = {};
//       let categoryProducts = {};

//       filteredInvoices.forEach(inv => {
//           inv.items.forEach(item => {
//               if (item.itemId) {
//                   const itemId = item.itemId._id.toString();
//                   const itemName = item.itemId.itemName || "Undefined";
//                   const itemQuantity = item.quantity || 0;
//                   const itemTotalAmount = inv.totalAmount || 0;

//                   // Get item details from enrichedItems
//                   const enrichedItem = itemMap.get(itemId);
//                   if (!enrichedItem) {
//                     return res.status(404).json({
//                       message: "Item not found",
//                     });
//                   } 

//                   console.log("enrichedItem",enrichedItem)

//                   const itemImage = enrichedItem.itemImage || null;
//                   const categories = Array.isArray(enrichedItem.categories) ? enrichedItem.categories : [enrichedItem.categories];
//                   const stockQty = enrichedItem.currentStock ?? 0;
//                   const currentStock = stockQty > 0 ? `In Stock (${stockQty})` : "Out of Stock";

//                   console.log("categories",categories)

//                   // Track overall top-selling products
//                   if (!topProducts[itemId]) {
//                       topProducts[itemId] = {
//                           itemId,
//                           itemName,
//                           totalSold: 0,
//                           totalAmount: 0,
//                           itemImage,
//                           currentStock
//                       };
//                   }
//                   topProducts[itemId].totalSold += itemQuantity;
//                   topProducts[itemId].totalAmount += itemTotalAmount;

//                   // Track top-selling products by category
//                   categories.forEach(category => {
//                       if (!categoryProducts[category]) {
//                           categoryProducts[category] = {};
//                       }

//                       if (!categoryProducts[category][itemId]) {
//                           categoryProducts[category][itemId] = {
//                               itemId,
//                               itemName,
//                               categories: category,
//                               totalAmount: 0,
//                               itemImage
//                           };
//                       }

//                       categoryProducts[category][itemId].totalAmount += itemTotalAmount;
//                   });
//               }
//           });
//       });

//       // Convert object to sorted arrays
//       const sortedTopProducts = Object.values(topProducts)
//           .sort((a, b) => b.totalSold - a.totalSold) // Sort by most sold items
//           .slice(0, 5); // Get top 5 products overall

//       let sortedCategoryProducts = [];
//       Object.keys(categoryProducts).forEach(category => {
//           sortedCategoryProducts.push(
//               ...Object.values(categoryProducts[category])
//                   .sort((a, b) => b.totalAmount - a.totalAmount) // Sort by highest revenue
//                   .slice(0, 5) // Get top 5 per category
//           );
//       });

//       console.log("Top 5 Overall Products:", sortedTopProducts);
//       console.log("Top 5 Products by Category:", sortedCategoryProducts);

//       // Response JSON
//       res.json({
//           topProducts: sortedTopProducts,
//           topProductsByCategory: sortedCategoryProducts
//       });

//   } catch (error) {
//       console.error("Error fetching top-selling products by category:", error);
//       res.status(500).json({ message: "Internal server error." });
//   }
// };



