
const Item = require('../database/model/item');
const BMCR = require('../database/model/bmcr');
const ItemTrack = require('../database/model/itemTrack');
const { getAllItemXS } = require('../controller/itemController')  //getAllItemXS.currentStock
const moment = require("moment-timezone");

exports.calculateTotalInventoryValue = async (req, res) => {
  try {    
    const organizationId = req.user.organizationId;
    
    // Get the start and end of the current month
    const startOfMonth = moment().startOf('month').toDate();
    const endOfMonth = moment().endOf('month').toDate();
    const topSelling = await topSellingProductsUtil(organizationId);
    const topSellingCategories = await getTopSellingProductCategory(organizationId);

    
    // // Fetch all items for the given organizationId
    // const items = await Item.find({ organizationId });

    // if (items.length === 0) {
    //   return res.status(404).json({ message: "No items found for the organization" });
    // }

    // Fetch enriched items from getAllItemXS
    const { enrichedItems } = await getAllItemXS({ user: { organizationId } }, { status: () => ({ json: () => {} }) });

    if (!enrichedItems || enrichedItems.length === 0) {
      return res.status(404).json({ message: "No items found for the organization" });
    }

    let totalInventoryValue = 0; // For costPrice
    let totalSalesValue = 0; // For sellingPrice
    let underStockItems = [];
    let recentlyAddedItems = [];

    // Loop through each item and calculate stock from the latest itemTrack entry
    for (const item of enrichedItems) {
      // Fetch stock details from getAllItemXS
     const allItemStocks = await getAllItemXS(organizationId);
     console.log("getAllItemXS",allItemStocks);


      // Find the stock details for this item
      // const stockData = allItemStocks.find(stock => stock._id.equals(item._id));
      const stockData = allItemStocks.currentStock || 0;
      let totalStock = 0
      totalStock = totalStock + stockData; // Use fetched stock, fallback to 0


      // // Find the last (most recent) entry for this item in ItemTrack
      // const latestTrack = await ItemTrack.findOne({
      //   itemId: item._id,
      //   organizationId: organizationId,
      // }).sort({ _id: -1 }); // Sort by _id to get the latest document (or use createdAt if preferred)

      // let totalStock = 0;

      // if (latestTrack) {
      //   totalStock = latestTrack.currentStock; // Use the currentStock from the latest track
      // }

      // Handle missing costPrice by setting it to 0 if not provided
      const costPrice = item.costPrice || 0;
      const inventoryValue = totalStock * costPrice;
      totalInventoryValue += inventoryValue; // Add to total inventory value (costPrice)

      // Calculate the sale value for the item using sellingPrice
      const sellingPrice = item.sellingPrice || 0; // Ensure sellingPrice has a default
      const saleValue = totalStock * sellingPrice;
      totalSalesValue += saleValue; // Add to total sale value (sellingPrice)

      // Check if totalStock is less than or equal to reorderPoint
      if (totalStock <= item.reorderPoint) {
        underStockItems.push(item); // Push the entire item document to underStockItems
      }

      // Check if the item was added in the current month
      const itemCreatedDate = moment(item.createdDate);
      if (itemCreatedDate.isBetween(startOfMonth, endOfMonth, null, '[]')) {
        recentlyAddedItems.push(item); // Push the entire item document to recentlyAddedItems
      }
    }

    // Calculate underStockItemsCount and recentlyAddedItemsCount
    const underStockItemsCount = underStockItems.length;
    const recentlyAddedItemsCount = recentlyAddedItems.length;

    // Use your total stock count function
    // const {date} = req.body
    const { date } = req.params;

    const totalStockCount = await getTotalInventoryValues(items, organizationId, date);
    const { inventoryValueChange , salesValueChange} = totalStockCount
    const { topSellingProducts  ,frequentlyOrderedItems, totalSoldValue} = topSelling
    const { topSellingProductCategories, stockLevels } = topSellingCategories
  
    // Send the response with all calculated data
    res.status(200).json({
      totalInventoryValue, // Calculated using costPrice
      totalSoldValue,
      totalSalesValue, // Calculated using sellingPrice
      // underStockItems, // Items where totalStock <= reorderPoint
      underStockItemsCount, // Count of underStockItems
      // recentlyAddedItems, // Items added in the current month
      recentlyAddedItemsCount, // Count of items added in the current month
      inventoryValueChange,
      salesValueChange ,
      topSellingProducts,
      frequentlyOrderedItems,
      stockLevels,
      topSellingProductCategories
      // totalStockCount
    });

  } catch (error) {
    console.error("Error calculating total inventory value:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const topSellingProductsUtil = async (organizationId) => {
  try {
    // Fetch all items for the given organizationId
    const items = await Item.find({ organizationId });

    if (items.length === 0) {
      return { topSellingProducts: [], frequentlyOrderedItems: [], totalSoldValue: 0 };
    }

    let topSellingProduct = [];
    let totalSoldValue = 0;

    for (const item of items) {
      // Fetch all sales (action: 'Sale') for this item
      const purchaseTrack = await ItemTrack.find({
        itemId: item._id,
        organizationId,
        action: "Sale",
      });

      // Get the latest stock entry
      const latestTrack = await ItemTrack.findOne({ itemId: item._id, organizationId }).sort({ _id: -1 });

      if (purchaseTrack.length > 0) {
        // Calculate total units sold
        const unitBought = purchaseTrack.reduce((total, track) => total + track.creditQuantity, 0);

        // Calculate sale volume
        const saleVolume = unitBought * (item.sellingPrice || 0);
        totalSoldValue += saleVolume;

        // Determine stock status
        const status = latestTrack && latestTrack.currentStock < 0 ? "Out Of Stock" : "In Stock";

        // Push to topSellingProduct
        topSellingProduct.push({
          itemName: item.itemName,
          itemId: item._id,
          saleVolume,
          unitBought,
          status,
        });
      }
    }

    // Sort and filter top-selling products
    const topSellingProducts = topSellingProduct.sort((a, b) => b.saleVolume - a.saleVolume).slice(0, 5);

    // Sort and filter frequently ordered items (excluding itemImage)
    const frequentlyOrderedItems = topSellingProduct
      .sort((a, b) => b.unitBought - a.unitBought)
      .slice(0, 4)
      .map(({ itemImage, ...rest }) => rest);

    return { topSellingProducts, frequentlyOrderedItems, totalSoldValue };
  } catch (error) {
    console.error("Error fetching top-selling products:", error);
    throw new Error("An error occurred while calculating top-selling products.");
  }
};


const getTopSellingProductCategory = async (organizationId) => {
  try {
    // Step 1: Find categories from the BMCR collection
    const categories = await BMCR.find({ organizationId, type: 'category' });
    const topSellingProductCategory = [];
    const stockLevels = [];

    // Step 2: Process each category
    for (const category of categories) {
      const { categoriesName } = category;

      // Step 3: Find items under this category
      const items = await Item.find({ organizationId, categories: categoriesName });

      let categorySalesValue = 0;
      const itemStockDetails = [];

      // Step 4: Process each item in the category
      for (const item of items) {
        const { _id, sellingPrice, itemName } = item;

        // Step 5: Find item tracks for this item
        const itemTracks = await ItemTrack.find({
          organizationId,
          itemId: _id,
          action: 'Sale',
        });

        // Step 6: Calculate total sales value for this item
        const itemSaleValue = itemTracks.reduce((sum, track) => {
          return sum + track.debitQuantity * sellingPrice;
        }, 0);

        // Step 7: Accumulate sales value for the category
        categorySalesValue += itemSaleValue;

        // Step 8: Get the latest stock document for this item
        const latestStockTrack = await ItemTrack.findOne({
          organizationId,
          itemId: _id,
        }).sort({ _id: -1  }); // Assuming createdAt is the field to sort by

        const currentStock = latestStockTrack ? latestStockTrack.currentStock : 0; // Use 0 if no stock track found

        // Step 9: Collect item stock details
        itemStockDetails.push({
          itemId: _id,
          itemName: itemName,
          stock: currentStock,
        });
      }

      // Step 10: Push the category sales data to the result array
      topSellingProductCategory.push({
        categoryName: categoriesName,
        salesValue: categorySalesValue,
      });

      // Step 11: Sort item stock details and pick top 5
      const topStockItems = itemStockDetails
        .sort((a, b) => b.stock - a.stock) // Sort by stock descending
        .slice(0, 5); // Get top 5 items

      // Step 12: Push the stock data for the category
      stockLevels.push({
        categoryName: categoriesName,
        items: topStockItems,
      });
    }

    // Sort and select top 5 selling categories
    const topSellingProductCategories = topSellingProductCategory
      .sort((a, b) => b.salesValue - a.salesValue)
      .slice(0, 5);

    // Step 13: Send the response with both top selling product categories and stock levels
    return {
      topSellingProductCategories,
      stockLevels,
    };
  } catch (error) {
    console.error('Error fetching top selling product categories:', error);
    throw new Error('Failed to fetch top selling product categories');
  }
};

// const getTopSellingProductCategory = async (organizationId) => {
//   try {
//       // Step 1: Find categories from the BMCR collection
//       const categories = await BMCR.find({ organizationId, type: 'category' });
//       const topSellingProductCategory = [];

//       // Step 2: Process each category
//       for (const category of categories) {
//           const { categoriesName } = category;

//           // Step 3: Find items under this category
//           const items = await Item.find({ organizationId , categories: categoriesName});

//           let categorySalesValue = 0;

//           // Step 4: Process each item in the category
//           for (const item of items) {
//               const { _id, sellingPrice } = item;

//               // Step 5: Find item tracks for this item
//               const itemTracks = await ItemTrack.find({
//                   itemId: _id,
//                   action: 'Sale',
//               });

//               // Step 6: Calculate total sales value for this item
//               const itemSaleValue = itemTracks.reduce((sum, track) => {
//                   return sum + track.debitQuantity * sellingPrice;
//               }, 0);

//               // Step 7: Accumulate sales value for the category
//               categorySalesValue += itemSaleValue;
//           }

//           // Step 8: Push the category sales data to the result array
//           topSellingProductCategory.push({
//               categoryName: categoriesName,
//               salesValue: categorySalesValue,
//           });
//       }
//       const topSellingProductCategories = topSellingProductCategory.sort((a, b) => b.salesValue - a.salesValue).slice(0, 5);

//       // Step 9: Send the response with the top selling product categories
//       return {
//         topSellingProductCategories,
//       };
//   } catch (error) {
//       console.error('Error fetching top selling product categories:', error);
//       throw new Error('Failed to fetch top selling product categories');
//   }
// };








const getTotalInventoryValues = async (items, organizationId, dateFromReq) => {
  try {
    // Parse the request date (YYYY-MM-DD)
    const givenMonth = moment(dateFromReq, "YYYY-MM-DD").format("MMMM"); // Get the month as "September"
    const givenYear = moment(dateFromReq, "YYYY-MM-DD").format("YYYY");  // Get the year as "2024"

    const previousMonth = moment(dateFromReq, "YYYY-MM-DD").subtract(1, 'month').format("MMMM");
    const previousYear = moment(dateFromReq, "YYYY-MM-DD").subtract(1, 'month').format("YYYY");

    let totalInventoryValueGivenMonth = 0;
    let totalInventoryValuePreMonth = 0;
    let totalSalesValueGivenMonth = 0;
    let totalSalesValuePreMonth = 0;

    // Loop through each item to calculate total inventory and sales values for the given month and previous month
    for (const item of items) {
      const costPrice = item.costPrice || 0; // Get costPrice from item collection
      const sellingPrice = item.sellingPrice || 0; // Get sellingPrice from item collection

      // Find the stock movement for the given month (matching only month and year)
      const stockGivenMonth = await ItemTrack.findOne({
        itemId: item._id,
        organizationId: organizationId,
        date: {
          $regex: new RegExp(`${givenMonth}/${givenYear}`)  // Match the "MMMM/YYYY" format
        }
      }).sort({ _id: -1 }); // Sort to get the latest document

      if (stockGivenMonth) {
        totalInventoryValueGivenMonth += stockGivenMonth.currentStock * costPrice;
        totalSalesValueGivenMonth += stockGivenMonth.currentStock * sellingPrice;
      }

      // for sales value

      
      // for sales value

      // Find the stock movement for the previous month (matching only month and year)
      const stockPreMonth = await ItemTrack.findOne({
        itemId: item._id,
        organizationId: organizationId,
        date: {
          $regex: new RegExp(`${previousMonth}/${previousYear}`)  // Match the "MMMM/YYYY" format
        }
      }).sort({ _id: -1 });

      if (stockPreMonth) {
        totalInventoryValuePreMonth += stockPreMonth.currentStock * costPrice;
        totalSalesValuePreMonth += stockPreMonth.currentStock * sellingPrice;
      }
    }

    // Calculate the percentage change for inventory and sales values
    const inventoryValueChange = totalInventoryValuePreMonth !== 0
      ? Math.round(((totalInventoryValueGivenMonth - totalInventoryValuePreMonth) / totalInventoryValuePreMonth) * 100 * 100) / 100
      : 0;  // If no previous month data, set to 0 instead of 100

    const salesValueChange = totalSalesValuePreMonth !== 0
      ? Math.round(((totalSalesValueGivenMonth - totalSalesValuePreMonth) / totalSalesValuePreMonth) * 100 * 100) / 100
      : 0;  // If no previous month data, set to 0 instead of 100

    // Return the calculated percentage changes
    return {
      totalInventoryValueGivenMonth,
      totalInventoryValuePreMonth,
      totalSalesValueGivenMonth,
      totalSalesValuePreMonth,
      inventoryValueChange,
      salesValueChange
    };
  } catch (error) {
    console.error("Error calculating total inventory and sales values:", error);
    throw new Error("An error occurred while calculating total inventory and sales values.");
  }
};


// const getTotalInventoryValues = async (items, organizationId, dateFromReq) => {
//   try {
//     // Parse the request date (YYYY-MM-DD)
//     const givenMonth = moment(dateFromReq, "YYYY-MM-DD").format("MMMM"); // Get the month as "September"
//     const givenYear = moment(dateFromReq, "YYYY-MM-DD").format("YYYY");  // Get the year as "2024"

//     const previousMonth = moment(dateFromReq, "YYYY-MM-DD").subtract(1, 'month').format("MMMM");
//     const previousYear = moment(dateFromReq, "YYYY-MM-DD").subtract(1, 'month').format("YYYY");

//     let totalInventoryValueGivenMonth = 0;
//     let totalInventoryValuePreMonth = 0;
//     let totalSalesValueGivenMonth = 0;
//     let totalSalesValuePreMonth = 0;

//     // Loop through each item to calculate total inventory and sales values for the given month and previous month
//     for (const item of items) {
//       const costPrice = item.costPrice || 0; // Get costPrice from item collection
//       const sellingPrice = item.sellingPrice || 0; // Get sellingPrice from item collection

//       // Find the stock movement for the given month (matching only month and year)
//       const stockGivenMonth = await ItemTrack.findOne({
//         itemId: item._id,
//         organizationId: organizationId,
//         date: {
//           $regex: new RegExp(`${givenMonth}/${givenYear}`)  // Match the "MMMM/YYYY" format
//         }
//       }).sort({ _id: -1 }); // Sort to get the latest document

//       if (stockGivenMonth) {
//         totalInventoryValueGivenMonth += stockGivenMonth.currentStock * costPrice;
//         totalSalesValueGivenMonth += stockGivenMonth.currentStock * sellingPrice;
//       }

//       // Find the stock movement for the previous month (matching only month and year)
//       const stockPreMonth = await ItemTrack.findOne({
//         itemId: item._id,
//         organizationId: organizationId,
//         date: {
//           $regex: new RegExp(`${previousMonth}/${previousYear}`)  // Match the "MMMM/YYYY" format
//         }
//       }).sort({ _id: -1 });

//       if (stockPreMonth) {
//         totalInventoryValuePreMonth += stockPreMonth.currentStock * costPrice;
//         totalSalesValuePreMonth += stockPreMonth.currentStock * sellingPrice;
//       }
//     }

//     // Calculate the percentage change for inventory and sales values
//     const inventoryValueChange = totalInventoryValuePreMonth !== 0
//     ? Math.round(((totalInventoryValueGivenMonth - totalInventoryValuePreMonth) / totalInventoryValuePreMonth) * 100 * 100) / 100
//     : (totalInventoryValueGivenMonth > 0 ? 100 : 0);

//   const salesValueChange = totalSalesValuePreMonth !== 0
//     ? Math.round(((totalSalesValueGivenMonth - totalSalesValuePreMonth) / totalSalesValuePreMonth) * 100 * 100) / 100
//     : (totalSalesValueGivenMonth > 0 ? 100 : 0);
//     // Return the calculated percentage changes
//     return {
      
//         totalInventoryValueGivenMonth,
//         totalInventoryValuePreMonth,
//         totalSalesValueGivenMonth,
//         totalSalesValuePreMonth,
//         inventoryValueChange,
//         salesValueChange

//     };
//   } catch (error) {
//     console.error("Error calculating total inventory and sales values:", error);
//     throw new Error("An error occurred while calculating total inventory and sales values.");
//   }
// };




