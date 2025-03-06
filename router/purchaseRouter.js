const express = require("express")

const router = new express.Router()

const purchaseOrderController = require('../controller/Purchase Order/purchaseOrderController');
const updateOrderController = require('../controller/Purchase Order/updateOrder');

const debitNoteController = require('../controller/Debit Note/debitNoteController'); 
const updateDebitNote = require('../controller/Debit Note/updateDebitNote'); 

const PaymentMadeController = require('../controller/Payment Made/paymentMadeController');
const updatePaymentMade = require('../controller/Payment Made/updatePaymentMade');

const purchaseSettingsController = require('../controller/purchaseSettingsController')

const billsController = require('../controller/Bills/billsController')
const updateBills = require('../controller/Bills/updateBills')

const SupplierController = require('../controller/supplierController')

const checkPermission = require('../controller/permission')
const { verifyToken } = require('../controller/middleware');

//Purchase Order
router.post('/add-purchaseOrder', verifyToken,checkPermission('Created a New Purchase Order'), purchaseOrderController.addPurchaseOrder);
router.get('/get-last-purchase-order-prefix', verifyToken,checkPermission('Created a New Purchase Order'), purchaseOrderController.getLastPurchaseOrderPrefix)

router.get('/get-all-purchaseOrders',verifyToken,checkPermission('Viewed Purchase Order'), purchaseOrderController.getAllPurchaseOrder);
router.get('/get-purchaseOrder/:orderId',verifyToken,checkPermission('Viewed Purchase Order'), purchaseOrderController.getOnePurchaseOrder);
router.put('/update-purchaseOrder/:orderId', verifyToken,checkPermission('Edited Purchase Order'), updateOrderController.updatePurchaseOrder);
router.delete('/delete-purchaseOrder/:orderId', verifyToken,checkPermission('Deleted Purchase Order'), updateOrderController.deletePurchaseOrder);



//Bills
router.post('/add-Bills',verifyToken,checkPermission('Created a New Purchase Bill'), billsController.addBills);
router.get('/get-last-bills-prefix', verifyToken,checkPermission('Created a New Purchase Bill'), billsController.getLastBillsPrefix);
router.get('/get-all-Bills',verifyToken,checkPermission('Viewed Purchase Bill'), billsController.getAllBills);
router.get('/get-a-Bill/:billId',verifyToken,checkPermission('Viewed Purchase Bill'), billsController.getOneBill);
router.get('/bill-journal/:billId',verifyToken,checkPermission('Viewed Purchase Bill'),billsController.billJournal);
router.put('/update-bill/:billId', verifyToken,checkPermission('Edited Purchase Bill'), updateBills.updateBill);
router.delete('/delete-bill/:billId', verifyToken,checkPermission('Deleted Purchase Bill'), updateBills.deletePurchaseBill); 


 //paymentMade
router.post('/add-payment', verifyToken,checkPermission('Created a New Purchase Payment'), PaymentMadeController.addPayment);
router.get('/getAllPayments', verifyToken,checkPermission('Viewed Purchase Payment'), PaymentMadeController.getAllPayment );
router.get('/payment-journal/:paymentId', verifyToken,checkPermission('Viewed Purchase Payment'), PaymentMadeController.paymentJournal);
router.get('/get-last-payment-made-prefix', verifyToken,checkPermission('Created a New Purchase Payment'), PaymentMadeController.getLastPaymentMadePrefix )
router.get('/getPayment/:paymentId', verifyToken,checkPermission('Viewed Purchase Payment'), PaymentMadeController.getPurchasePayment);
router.put('/update-paymentMade/:paymentId', verifyToken,checkPermission('Edited Purchase Payment'), updatePaymentMade.updatePaymentMade);
router.delete('/delete-paymentMade/:paymentId', verifyToken,checkPermission('Deleted Purchase Payment'), updatePaymentMade.deletePaymentMade);


//Debit Note
router.post('/add-DebitNote', verifyToken,checkPermission('Created a New Purchase Debit Note'), debitNoteController.addDebitNote);
router.get('/get-last-debit-note-prefix', verifyToken,checkPermission('Created a New Purchase Debit Note'), debitNoteController.getLastDebitNotePrefix)
router.get('/get-all-debitNote', verifyToken,checkPermission('Viewed Purchase Debit Note'), debitNoteController.getAllDebitNote);
router.get('/getDebitNote/:debitId', verifyToken,checkPermission('Viewed Purchase Debit Note'), debitNoteController.getOneDebitNote);
router.get('/debitNote-journal/:debitId', verifyToken,checkPermission('Viewed Purchase Debit Note'), debitNoteController.debitNoteJournal);
router.put('/update-debitNote/:debitId', verifyToken,checkPermission('Edited Purchase Debit Note'), updateDebitNote.updateDebitNote);
router.delete('/delete-debitNote/:debitId', verifyToken,checkPermission('Deleted Purchase Debit Note'), updateDebitNote.deleteDebitNote);


// purchase settings
router.put('/add-purchase-settings', verifyToken,checkPermission('Added a new Setting'), purchaseSettingsController.updatePurchaseSettings)


// supplier transactions 
router.get('/get-supplier-purchaseOrders/:id', verifyToken, SupplierController.getPurchaseOrderSupplier);


module.exports = router