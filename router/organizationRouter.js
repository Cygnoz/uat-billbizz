const express = require("express")
const router = new express.Router()

const organizationController = require("../controller/organizationController");

const billBizzClientCont = require("../controller/Client creation/billBizzClientCont")
const sewnexClientCont = require("../controller/Client creation/sewnexClientCont")


const currencyController = require("../controller/settings/currencyController")
const paymentTermCont = require("../controller/settings/paymentTermCont")
const prefixController = require("../controller/settings/prefixController")
const settingController = require("../controller/settings/settingController")
const taxController = require("../controller/settings/taxController")
const userController = require("../controller/userController")
const dashboardController = require("../controller/dashboardCont")


const checkPermission = require('../controller/permission');
const { verifyToken } = require('../controller/middleware');
const { nexVerifyToken } = require('../controller/nexMiddleware');




//Basic
router.get('/get-countries-data',verifyToken,organizationController.getCountriesData)

router.get('/get-additional-data',verifyToken,organizationController.getAdditionalData)



//Organization
router.post('/setup-organization',verifyToken,checkPermission('Setup/Modified Organization Details'),organizationController.setupOrganization)

router.get('/get-one-organization',verifyToken,organizationController.getOneOrganization)










// Setting

router.get('/get-settings',verifyToken,checkPermission('Viewed Setting details'),settingController.getSettings)





// Currency

router.get('/get-currency',verifyToken,checkPermission('Viewed Setting details'),currencyController.getCurrency)

router.get('/view-currency/:id',verifyToken,checkPermission('Viewed Setting details'),currencyController.viewCurrency)

router.post('/add-currency',verifyToken,checkPermission('Added a new Setting'),currencyController.addCurrency)

router.put('/edit-currency',verifyToken,checkPermission('Edited Setting details'),currencyController.editCurrency)

router.delete('/delete-currency/:currencyId',verifyToken,checkPermission('Deleted a Setting'),currencyController.deleteCurrency)





// Invoice 

router.put('/add-invoice-settings',verifyToken,checkPermission('Added a new Setting'),settingController.updateInvoiceSettings)





// Payment Terms

router.post('/add-payment-terms',verifyToken,checkPermission('Added a new Setting'),paymentTermCont.addPaymentTerm)

router.put('/edit-payment-terms/:id',verifyToken,checkPermission('Edited Setting details'),paymentTermCont.editPaymentTerm)

router.delete('/delete-payment-terms',verifyToken,checkPermission('Deleted a Setting'),paymentTermCont.deletePaymentTerm)

router.get('/get-all-payment-terms',verifyToken,checkPermission('Viewed Setting details'),paymentTermCont.getAllPaymentTerms)





//Tax

router.post('/add-tax',verifyToken,checkPermission('Added a new Setting'),taxController.addTax)

router.put('/edit-tax',verifyToken,checkPermission('Edited Setting details'),taxController.editTaxRate)

router.get('/get-tax',verifyToken,checkPermission('Viewed Setting details'),taxController.getTax)





//Prefix

router.post('/add-prefix',verifyToken,checkPermission('Added a new Setting'),prefixController.addPrefix)

router.get('/get-prefix',verifyToken,checkPermission('Viewed Setting details'),prefixController.getPrefix)

router.put('/edit-prefix',verifyToken,checkPermission('Edited Setting details'),prefixController.updatePrefix)

router.delete('/prefix/:seriesId',verifyToken,checkPermission('Deleted a Setting'),prefixController.deletePrefix)

router.put('/status-prefix',verifyToken,checkPermission('Edited Setting details'),prefixController.setPrefixSeriesStatusTrue)



//Main Dashboard
router.get('/get-mainDashboard-overview', verifyToken, dashboardController.getOverviewData)
router.get('/get-mainDashboard-salesOverTime', verifyToken, dashboardController.getSalesOverTime)
router.get('/get-mainDashboard-expenseByCategory', verifyToken, dashboardController.getExpenseByCategory)
router.get('/get-mainDashboard-topProductCustomer', verifyToken, dashboardController.getTopProductCustomer)







//Internal

router.get('/get-all-organization',nexVerifyToken,organizationController.getAllOrganization)

router.get('/get-all-client',nexVerifyToken,billBizzClientCont.getAllClient)

router.delete('/delete-organization/:organizationId',nexVerifyToken,organizationController.deleteOrganization)

router.delete('/delete-all',nexVerifyToken,billBizzClientCont.deleteAll)




//Nex Portal
router.get('/get-one-organization-nex/:organizationId',nexVerifyToken,billBizzClientCont.getOneOrganizationNex)

router.post('/create-billbizz-client',billBizzClientCont.createOrganizationAndClient)

router.post('/create-sewnex-client',sewnexClientCont.createOrganizationAndClient)


//Login
router.post('/login',userController.login)

router.post('/verify-otp',userController.verifyOtp)






module.exports = router
















