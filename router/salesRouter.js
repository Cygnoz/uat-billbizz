const express = require("express")

const router = new express.Router()

const salesQuotes = require('../controller/Quote/salesQuotes')
const updateSalesQuotes = require('../controller/Quote/updateQuotes')

const salesOrder = require('../controller/Order/salesOrder')
const updateSalesOrder = require('../controller/Order/updateSalesOrder')

const salesInvoice = require('../controller/Invoice/salesInvoice')
const updateSalesInvoice = require('../controller/Invoice/updateInvoice')

const salesReceipt = require('../controller/Receipt/salesReceipt')
const updateSalesReceipt = require('../controller/Receipt/updateReceipt')

const creditNote = require('../controller/Credit Note/creditNoteController')
const updateCreditNote = require('../controller/Credit Note/updateCreditNote')

const salesSettings = require('../controller/salesSettings')

const dashboardCont = require('../controller/dashboardCont')

const checkPermission = require('../controller/permission');
const { verifyToken } = require('../controller/middleware');




// Dashboard
router.get('/get-salesDashboard-overview', verifyToken, dashboardCont.getOverviewData)
router.get('/get-salesDashboard-topSalesOrder', verifyToken, dashboardCont.getTopSalesOrder)
router.get('/get-salesDashboard-recentTransactions', verifyToken, dashboardCont.getRecentTransactions)



//Sales settings
router.put('/add-sales-settings',verifyToken,checkPermission("Added a new Setting"),salesSettings.addSalesOrderSettings)

router.put('/add-creditNote-settings',verifyToken,checkPermission("Added a new Setting"),salesSettings.updateCreditNoteSettings)



//Sales Quotes
router.post('/add-sales-quotes',verifyToken,checkPermission("Created a New Quote"),salesQuotes.addQuotes)

router.get('/get-last-sales-quotes-prefix',verifyToken,checkPermission("Created a New Quote"),salesQuotes.getLastQuotesPrefix)

router.get('/get-all-sales-quotes',verifyToken,checkPermission("Viewed Quote Details"),salesQuotes.getAllSalesQuote)

router.get('/get-one-sales-quotes/:quoteId',verifyToken,checkPermission("Viewed Quote Details"),salesQuotes.getOneSalesQuote)

router.put('/update-sales-quotes/:quoteId',verifyToken,checkPermission("Edited Quote Information"),updateSalesQuotes.updateSalesQuote)

router.delete('/delete-sales-quotes/:quoteId',verifyToken, checkPermission("Deleted Quote Information"),updateSalesQuotes.deleteSalesQuote)



//Sales Order
router.post('/add-sales-order',verifyToken,checkPermission("Created a New Order"),salesOrder.addOrder)

router.get('/get-last-sales-order-prefix',verifyToken,checkPermission("Created a New Order"),salesOrder.getLastOrderPrefix)

router.get('/get-all-sales-order',verifyToken,checkPermission("Viewed Order Details"),salesOrder.getAllSalesOrder)

router.get('/get-one-sales-order/:orderId',verifyToken,checkPermission("Viewed Order Details"),salesOrder.getOneSalesOrder)

router.put('/update-sales-order/:orderId',verifyToken,checkPermission("Edited Order Information"),updateSalesOrder.updateSalesOrder) 

router.delete('/delete-sales-order/:orderId',verifyToken,checkPermission("Deleted Order Information"),updateSalesOrder.deleteSalesOrder) 



// Delivery Chellans
router.put('/add-deliveryChellans',verifyToken,checkPermission("Added a new Setting"),salesSettings.addDeliveryChellans);



//Shipment
router.put('/add-shipment-address-settings',verifyToken,checkPermission("Added a new Setting"),salesSettings.addShipmentAddressSettings)



//Sales Invoice
router.post('/sales-invoice',verifyToken,checkPermission("Created a New Invoice"),salesInvoice.addInvoice)

router.put('/sales-invoice-settings',verifyToken,checkPermission("Added a new Setting"),salesSettings.addInvoiceSettings)

router.get('/sales-invoice-prefix',verifyToken,checkPermission("Created a New Invoice"),salesInvoice.getLastInvoicePrefix)

router.get('/invoice-journal/:invoiceId',verifyToken,checkPermission("Viewed Invoice Details"),salesInvoice.invoiceJournal)

router.get('/sales-invoice',verifyToken,checkPermission("Viewed Invoice Details"),salesInvoice.getAllSalesInvoice)

router.get('/sales-invoice/:invoiceId',verifyToken,checkPermission("Viewed Invoice Details"),salesInvoice.getOneSalesInvoice)

router.put('/update-sales-invoice/:invoiceId',verifyToken,checkPermission("Edited Invoice Information"),updateSalesInvoice.updateInvoice)

router.delete('/delete-sales-invoice/:invoiceId',verifyToken,checkPermission("Deleted Invoice Information"),updateSalesInvoice.deleteSalesInvoice)



//Sales receipt
router.post('/sales-receipt',verifyToken,checkPermission("Created a New Receipt"),salesReceipt.addReceipt)

router.get('/get-all-receipt',verifyToken,checkPermission("Viewed Receipt Details"),salesReceipt.getAllSalesReceipt)

router.get('/get-receipt/:receiptId',verifyToken,checkPermission("Viewed Receipt Details"),salesReceipt.getSalesReceipt)

router.get('/get-last-salesReceipt-prefix', verifyToken,checkPermission("Created a New Receipt"),salesReceipt.getLastSalesReceiptPrefix);

router.get('/receipt-journal/:receiptId',verifyToken,checkPermission("Viewed Receipt Details"),salesReceipt.receiptJournal)

router.put('/update-sales-receipt/:receiptId',verifyToken,checkPermission("Edited Receipt Information"),updateSalesReceipt.updateReceipt)

router.delete('/delete-sales-receipt/:receiptId',verifyToken,checkPermission("Deleted Receipt Information"),updateSalesReceipt.deleteSalesReceipt)



//Credit Note
router.post('/add-creditNote',verifyToken,checkPermission("Created a New Credit Note"),creditNote.addCreditNote);

router.get('/get-all-creditNote',verifyToken,checkPermission("Viewed Credit Note Details"),creditNote.getAllCreditNote);

router.get('/get-one-creditNote/:creditId',verifyToken,checkPermission("Viewed Credit Note Details"),creditNote.getOneCreditNote);

router.get('/get-last-creditNote-prefix',verifyToken,checkPermission("Created a New Credit Note"),creditNote.getLastCreditNotePrefix);

router.put('/update-creditNote/:creditId',verifyToken,checkPermission("Edited Credit Note Information"),updateCreditNote.updateCreditNote);

router.get('/creditNote-journal/:creditId',verifyToken,checkPermission("Viewed Credit Note Details"),creditNote.creditNoteJournal);

router.delete('/delete-creditNote/:creditId',verifyToken,checkPermission("Deleted Credit Note Information"),updateCreditNote.deleteCreditNote);






module.exports = router