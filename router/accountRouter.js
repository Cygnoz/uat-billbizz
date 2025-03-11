const express = require("express")
const router = new express.Router()

const accountController = require("../controller/accountController")
const journalController = require("../controller/journalController")

const accountDashboard = require("../controller/accountsDashboard")

const checkPermission = require('../controller/permission');
const { verifyToken } = require('../controller/middleware');
const { nexVerifyToken } = require('../controller/nexMiddleware');



// Dashboard
router.get('/get-accountDashboard-overview', verifyToken, accountDashboard.getOverviewData)
router.get('/get-accountDashboard-totalRevenueOverTime', verifyToken, accountDashboard.getTotalRevenueOverTime)
router.get('/get-accountDashboard-accountReceivableAging', verifyToken, accountDashboard.getAccountReceivableAging)
router.get('/get-accountDashboard-accountPayableAging', verifyToken, accountDashboard.getAccountPayableAging)
router.get('/get-accountDashboard-invoiceStatus', verifyToken, accountDashboard.getInvoiceStatus)



//Accounts
router.post('/add-account',verifyToken,checkPermission('Created a New Account'),accountController.addAccount)

router.get('/get-all-account',verifyToken,checkPermission('Viewed Account Information'),accountController.getAllAccount)

router.get('/get-one-account/:accountId',verifyToken,checkPermission('Viewed Account Information'),accountController.getOneAccount)

router.put('/edit-account/:accountId',verifyToken,checkPermission('Edited Account Information'),accountController.editAccount)

router.delete('/delete-account/:accountId',verifyToken,checkPermission('Deleted an Account'),accountController.deleteAccount)






//Journal
router.post('/add-journal-entry',verifyToken,checkPermission('Added a Journal Entry'),journalController.addJournalEntry)

router.get('/get-all-journal',verifyToken,checkPermission('Viewed Journal Entry'),journalController.getAllJournal)

router.get('/get-one-journal/:id',verifyToken,checkPermission('Viewed Journal Entry'),journalController.getOneJournal)

router.get('/get-last-journal-prefix',verifyToken,checkPermission('Added a Journal Entry'),journalController.getLastJournalPrefix)

router.put('/update-journal/:id',verifyToken,checkPermission('Edited Journal Entry'),journalController.updateJournalEntry)

router.delete('/delete-journal/:id',verifyToken,checkPermission('Deleted Journal Entry'),journalController.deleteJournalEntry)






//Trial Balance

router.get('/get-one-trial-balance/:accountId',verifyToken,checkPermission('Viewed Account Information'),accountController.getOneTrailBalance)



//Nexportal
router.get('/get-all-account-nexportal',nexVerifyToken,accountController.getAllAccount)


module.exports = router
