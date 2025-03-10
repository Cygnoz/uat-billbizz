const express = require("express")

const router = new express.Router()
const staffController = require("../controller/staffController")

const checkPermission = require('../controller/permission');
const { verifyToken } = require('../controller/middleware');


// Staff
router.post('/add-staff', verifyToken, staffController.addStaff);
router.put('/edit-staff/:staffId', verifyToken, staffController.editStaff);
router.get('/get-staff', verifyToken, staffController.getAllStaff);
router.get('/get-staff/:staffId', verifyToken, staffController.getStaffById);
router.delete('/delete-staff/:staffId', verifyToken, staffController.deleteStaff);


module.exports = router