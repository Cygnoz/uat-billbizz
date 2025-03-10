const express = require("express")

const router = new express.Router()
const staffController = require("../controller/staffController")

const checkPermission = require('../controller/permission');
const { verifyToken } = require('../controller/middleware');


// Staff
router.post('/add-staff', verifyToken, staffController.addStaff);
router.put('/edit-staff/:staffId', verifyToken, staffController.editStaff);



module.exports = router