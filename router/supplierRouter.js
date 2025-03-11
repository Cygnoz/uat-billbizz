const express = require("express")
const router = new express.Router()

const supplierCont = require('../controller/supplierController');
const supplierSettings = require('../controller/supplierSettings')
const importController = require('../controller/importSupplier')
const dashboardController = require("../controller/dashboardController")
const dashboardCont = require("../controller/dashboardCont")


const checkPermission = require('../controller/permission')
const { verifyToken } = require('../controller/middleware');

// supplier
router.get('/get-Supplier-Trandactions/:supplierId', verifyToken, checkPermission('Viewed Supplier Details'), supplierCont.getSupplierTransactions);

router.post('/add-suppliers',verifyToken,checkPermission('Created a New Supplier'), supplierCont.addSupplier);

router.get('/get-all-supplier',verifyToken,checkPermission('Viewed Supplier Details'), supplierCont.getAllSuppliers);

router.get('/get-supplier/:supplierId',verifyToken,checkPermission('Viewed Supplier Details'), supplierCont.getOneSupplier);

router.put('/update-supplier/:supplierId',verifyToken,checkPermission('Edited Supplier Information'), supplierCont.updateSupplier);

router.delete('/delete-supplier/:supplierId',verifyToken, checkPermission('Deleted Supplier Information'), supplierCont.deleteSupplier);


router.put('/update-supplier-status/:supplierId' ,verifyToken,checkPermission('Viewed Supplier Details'),supplierCont.updateSupplierStatus)

router.get('/supplier-additional-data',verifyToken,checkPermission('Viewed Supplier Details'), supplierCont.getSupplierAdditionalData);

router.post('/import-supplier',verifyToken,checkPermission('Import New Suppliers'),importController.importSupplier);

router.get('/get-one-supplier-history/:supplierId',verifyToken,checkPermission('Viewed Supplier Details'),supplierCont.getOneSupplierHistory)

router.put('/update-supplier-customer-settings',verifyToken,checkPermission('Edited Setting details'),supplierSettings.updateSupplierCustomerSettings)



//stat

router.get('/get-Supplier-Dashboard/:date',verifyToken,checkPermission('Viewed Supplier Details'),dashboardController.getSupplierStats);

router.get('/get-supplier-bill/:supplierId',verifyToken,checkPermission('Viewed Supplier Details'),dashboardController.supplierBills);


// Dashboard
router.get('/get-supplierDashboard-overview', verifyToken, dashboardCont.getOverviewData);
router.get('/get-supplierDashboard-topProductsBySupplier', verifyToken, dashboardCont.getTopProductsBySupplier);
router.get('/get-supplierDashboard-averageDeliveryTime', verifyToken, dashboardCont.getAverageDeliveryTime);
router.get('/get-supplierDashboard-topSupplierBySpend', verifyToken, dashboardCont.getTopSupplierBySpend);
router.get('/get-supplierDashboard-topOrdersBySupplier', verifyToken, dashboardCont.getTopOrdersBySupplier);




module.exports = router