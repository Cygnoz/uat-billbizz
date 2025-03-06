
const mongoose = require('mongoose');
const PurchaseOrder = require('../../database/model/purchaseOrder');
const Bills = require('../../database/model/bills');
const SupplierHistory = require("../../database/model/supplierHistory");

const { dataExist, purchaseOrder, validation, calculations } = require("../Purchase Order/purchaseOrderController");
const { cleanData } = require("../../services/cleanData");



// Update Purchase Order 
exports.updatePurchaseOrder = async (req, res) => {
    console.log("Update purchase order:", req.body);
  
    try {
      const { organizationId, id: userId, userName } = req.user;
      const { orderId } = req.params;

      // Clean input data
      const cleanedData = cleanData(req.body);

      const { items, supplierId } = cleanedData;
  
      // Fetch existing purchase order
      const existingPurchaseOrder = await PurchaseOrder.findOne({ _id: orderId, organizationId });
      if (!existingPurchaseOrder) {
        console.log("Purchase order not found with ID:", orderId);
        return res.status(404).json({ message: "Purchase order not found" });
      }
    
      // Validate Supplier
      if (!mongoose.Types.ObjectId.isValid(supplierId) || supplierId.length !== 24) {
        return res.status(400).json({ message: `Invalid Supplier ID: ${supplierId}` });
      }
  
      // Validate ItemIds
      const itemIds = items.map(item => item.itemId);
      const invalidItemIds = itemIds.filter(itemId => !mongoose.Types.ObjectId.isValid(itemId) || itemId.length !== 24);
      if (invalidItemIds.length > 0) {
        return res.status(400).json({ message: `Invalid item IDs: ${invalidItemIds.join(', ')}` });
      }
  
      // Check for duplicate itemIds
      const uniqueItemIds = new Set(itemIds);
      if (uniqueItemIds.size !== itemIds.length) {
        return res.status(400).json({ message: "Duplicate Item found in the list." });
      }
  
      // Fetch related data
      const { organizationExists, supplierExist, itemTable, existingPrefix } = await dataExist.dataExist(organizationId, supplierId, items);
  
      // Organization, Supplier, and Prefix Validation
      if (!validation.validateOrganizationSupplierPrefix(organizationExists, supplierExist, existingPrefix, res)) return;
  
      // Validate Inputs
      if (!validation.validateInputs(cleanedData, supplierExist, items, itemTable, organizationExists, res)) return;
  
      // Tax Type 
      calculations.taxType(cleanedData, supplierExist);
  
      // Calculate Purchase Order
      if (!calculations.calculatePurchaseOrder(cleanedData, res)) return;
  
      // Ensure `purchaseOrder` field matches the existing order
      const purchaseOrder = cleanedData.purchaseOrder;
      if (purchaseOrder !== existingPurchaseOrder.purchaseOrder) {
        console.error("Mismatched purchaseOrder values.");
        return res.status(400).json({
            message: `The provided purchaseOrder does not match the existing record. Expected: ${existingPurchaseOrder.purchaseOrder}`
        });
    }

      // Update Purchase Order Fields (Ensure system-managed fields are untouched)
      existingPurchaseOrder.set({
        ...cleanedData,
        lastModifiedDate: new Date(),
      });
  
      // Save Updated Purchase Order
      const savedPurchaseOrder = await existingPurchaseOrder.save();
      if (!savedPurchaseOrder) {
          console.error("Failed to save updated purchase order.");
          return res.status(500).json({ message: "Failed to update purchase order" });
      }

      // Add entry to Supplier History
      const supplierHistoryEntry = new SupplierHistory({
        organizationId,
        operationId: savedPurchaseOrder._id,
        supplierId,
        title: "Purchase Order Updated",
        description: `Purchase Order ${savedPurchaseOrder.purchaseOrder} updated by ${userName}`,  
        userId: userId,
        userName: userName,
      });
  
      await supplierHistoryEntry.save();
  
      res.status(200).json({ message: "Purchase order updated successfully", savedPurchaseOrder });
      console.log("Purchase order updated successfully:", savedPurchaseOrder);
  
    } catch (error) {
      console.error("Error updating purchase order:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  };








  // Delete Purchase order
exports.deletePurchaseOrder = async (req, res) => {
  console.log("Delete purchase order request received:", req.params);

  try {
      const { organizationId, id: userId, userName } = req.user;
      const { orderId } = req.params;

      // Validate orderId
      if (!mongoose.Types.ObjectId.isValid(orderId) || orderId.length !== 24) {
          return res.status(400).json({ message: `Invalid Purchase Order ID: ${orderId}` });
      }

      // Fetch existing purchase order
      const existingPurchaseOrder = await PurchaseOrder.findOne({ _id: orderId, organizationId });
      if (!existingPurchaseOrder) {
          console.log("Purchase order not found with ID:", orderId);
          return res.status(404).json({ message: "Purchase order not found" });
      }

      // Add entry to Supplier History
      const supplierHistoryEntry = new SupplierHistory({
        organizationId,
        operationId: existingPurchaseOrder._id,
        supplierId: existingPurchaseOrder.supplierId,
        title: "Purchase Order Deleted",
        description: `Purchase Order ${existingPurchaseOrder.purchaseOrder} deleted by ${userName}`,  
        userId: userId,
        userName: userName,
      });

      // Delete the purchase order
      const deletedPurchaseOrder = await existingPurchaseOrder.deleteOne();
      if (!deletedPurchaseOrder) {
          console.error("Failed to delete purchase order.");
          return res.status(500).json({ message: "Failed to delete purchase order" });
      }
  
      await supplierHistoryEntry.save();

      res.status(200).json({ message: "Purchase order deleted successfully" });
      console.log("Purchase order deleted successfully with ID:", orderId);

  } catch (error) {
      console.error("Error deleting purchase order:", error);
      res.status(500).json({ message: "Internal server error" });
  }
};