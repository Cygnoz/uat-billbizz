const express = require("express")

const router = new express.Router()

// const importController = require("../controller/importCustomer")
const customerController = require("../controller/customerCont")
const customerSettings = require('../controller/customerSettings')
const dashboardController = require("../controller/dashboardController")
const dashboardCont = require("../controller/dashboardCont")

const checkPermission = require('../controller/permission');
const { verifyToken } = require('../controller/middleware');




//Basic
router.get('/customer-additional-data', verifyToken,customerController.getCustomerAdditionalData);


// Dashboard
router.get('/get-customerDashboard-overview', verifyToken, dashboardCont.getOverviewData);
router.get('/get-customerDashboard-topCustomers', verifyToken, dashboardCont.getTopCustomers);
router.get('/get-customerDashboard-retentionRateOverTime', verifyToken, dashboardCont.getCustomerRetentionOverTime);
router.get('/get-customerDashboard-averageOrderValue', verifyToken, dashboardCont.getAverageOrderValue);



//Customer
router.post('/add-customer',verifyToken,checkPermission('Created a New Customer'),customerController.addCustomer)

router.get('/get-all-customer',verifyToken,checkPermission('Viewed Customer details'),customerController.getAllCustomer)

router.get('/get-one-customer/:customerId',verifyToken,checkPermission('Viewed Customer details'),customerController.getOneCustomer)

router.put('/edit-customer/:customerId', verifyToken,checkPermission('Edited Customer information'),customerController.editCustomer);

router.put('/update-customer-status/:customerId', verifyToken,checkPermission('Edited Customer information'),customerController.updateCustomerStatus);

router.delete('/delete-customer/:customerId',verifyToken,checkPermission('Deleted Customer'),customerController.deleteCustomer);




router.get('/get-customer-transaction/:customerId',verifyToken,checkPermission('Viewed Customer details'),customerController.getCustomerTransactions);

router.get('/get-customer-dashboard/:date',verifyToken,checkPermission('Viewed Customer details'),dashboardController.getCustomerStats);

router.get('/get-one-customer-dashboard/:customerId',verifyToken,checkPermission('Viewed Customer details'),dashboardController.getOneCustomerStats);

router.get('/get-customer-sales-history/:customerId',verifyToken,checkPermission("Viewed Customer details"),dashboardController.customerSaleHistory);

router.get('/get-customer-sales-receipt/:customerId',verifyToken,checkPermission("Viewed Customer details"),dashboardController.customerSalesReceipt);    

router.put('/update-customer-settings',verifyToken,checkPermission('Added a new Setting'),customerSettings.updateCustomerSettings)



//Import
// router.post('/import-customer',verifyToken,checkPermission('Imported New Customers'), importController.importCustomer);


//Customer History
router.get('/get-one-customer-history/:customerId',verifyToken,checkPermission('Viewed Customer details'),customerController.getOneCustomerHistory)

module.exports = router











module.exports = router