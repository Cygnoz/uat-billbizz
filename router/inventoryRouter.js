const express = require("express")

const router = new express.Router()

const itemController = require("../controller/itemController");
const unitController = require("../controller/unitController")
const bmcrController = require('../controller/bmcrController');
const itemDropdownController = require("../controller/itemDropdownController")
const itemSettingsController = require("../controller/itemSettingsController")
const dashboardController = require("../controller/dashboardController")


const checkPermission = require('../controller/permission');
const { verifyToken } = require('../controller/middleware');

//item Drop Down
router.get('/get-itemDropdown',verifyToken, itemDropdownController.getItemDropDown);

router.get('/get-inventoryDashboard-overview',verifyToken, dashboardController.getOverviewData);
router.get('/get-inventoryDashboard-topSellingProducts',verifyToken, dashboardController.getTopSellingProducts);



// Item
router.post('/add-item',verifyToken,checkPermission('Created a New Item'), itemController.addItem);
router.get('/get-all-item',verifyToken,checkPermission('Viewed Item Information'), itemController.getAllItem);
router.get('/get-all-item-xs',verifyToken,checkPermission('Viewed Item Information'), itemController.getAllItemXS);
router.get('/get-all-item-m',verifyToken,checkPermission('Viewed Item Information'), itemController.getAllItemM);

router.get('/get-one-item/:itemId',verifyToken,checkPermission('Viewed Item Information'), itemController.getAItem)
router.put('/edit-item/:itemId',verifyToken,checkPermission('Edited Item Information'), itemController.updateItem)
router.delete('/delete-item/:itemId',verifyToken,checkPermission('Deleted an Item'), itemController.deleteItem)


// Unit
router.post('/add-unit',verifyToken,checkPermission('Created a New Item'), unitController.addUnit);
router.get('/get-all-unit',verifyToken,checkPermission('Created a New Item'), unitController.getAllUnit);
router.get('/get-one-unit/:_id',verifyToken,checkPermission('Created a New Item'), unitController.getOneUnit);
router.put('/edit-unit/:_id',verifyToken,checkPermission('Created a New Item'), unitController.updateUnit);
router.delete('/delete-unit/:id',verifyToken,checkPermission('Created a New Item'), unitController.deleteUnit);

// Unit Conversion
// router.post('/add-unitConversion', unitController.addUnitConversion);
// router.put('/get-all-unitConversion', unitController.getAllUnitConversion);
// router.get('/get-one-unitConversion/:_id', unitController.getOneUnitConversion);
// router.put('/edit-unitConversion', unitController.updateUnitConversion);
// router.delete('/delete-unitConversion/:id', unitController.deleteUnitConversion);



//BMCR - Brand Manufacturer Category Rack
router.post('/add-bmcr',verifyToken,checkPermission('Created a New Item'), bmcrController.addBmcr);
router.put('/get-all-bmcr',verifyToken,checkPermission('Created a New Item'), bmcrController.getAllBmcr);
router.get('/get-a-bmcr/:id',verifyToken,checkPermission('Created a New Item'), bmcrController.getABmcr);
router.put('/update-bmcr',verifyToken,checkPermission('Created a New Item'), bmcrController.updateBmcr);
router.delete('/delete-bmcr/:id',verifyToken,checkPermission('Created a New Item'), bmcrController.deleteBmcr)



 
//items settings
router.put('/add-item-settings',verifyToken,checkPermission('Added a new Setting'), itemSettingsController.addItemSettings);





//Item Track
router.get('/get-all-item-track',verifyToken,checkPermission('Viewed Item Information'), itemSettingsController.getAllItemTrack);
router.get('/get-item-transaction/:id',verifyToken,checkPermission('Viewed Item Information'), itemSettingsController.itemTransaction);




module.exports = router