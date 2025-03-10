const bcrypt = require('bcryptjs');
const Staff = require('../database/model/staff');
const Users = require('../database/model/user');
const Role = require('../database/model/role');
const Organization = require('../database/model/organization');
const { cleanData } = require('../services/cleanData');


const dataExist = async ( organizationId, email, staffId ) => {
    const [organizationExists, existingUser  ] = await Promise.all([
      Organization.findOne({ organizationId }, { organizationId: 1, organizationCountry: 1, state: 1, timeZoneExp: 1 }),
      Users.findOne({ organizationId, userEmail: email }, { organizationId: 1, userEmail: 1 }), 
    ]);
    console.log("existingUser", existingUser)
    return { organizationExists, existingUser };
};




// Add Staff
exports.addStaff = async (req, res) => {
    console.log("Add Staff :", req.body);
    try {
        const cleanedData = cleanData(req.body);

        const { organizationId, id: userId, userName } = req.user;

        const {  email, password } = cleanedData;

        // const existingRole = await Role.findOne({ organizationId, roleName: "Staff" });
        // if (!existingRole) {
        //   console.log("Role doesn't exist!");
        //   return res.status(404).json({ message: "Role doesn't exist!" });
        // }

        const { organizationExists, existingUser } = await dataExist( organizationId, email, null );   
        
        if (!validateDataExist( organizationExists, res )) return;
        
        if (existingUser) return res.status(409).json({ message: 'User with this email already exists.' });
        
        if (!validateInputs( cleanedData, organizationExists, res)) return;
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const user = await Users.create({
          organizationId,
          userName: cleanedData.staffName,
          userNum: cleanedData.contact,
          userEmail: cleanedData.email,
          password: hashedPassword,
          role: 'Staff',
        });

        const staff = await Staff.create({ ...cleanedData, email, password: hashedPassword, organizationId });
        
        res.status(201).json({ message: 'Staff added successfully', staff });
    } catch (error) {
        console.error("Error in addStaff:", error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Edit Staff
exports.editStaff = async (req, res) => {
  console.log("Edit Staff:", req.body);
    try {
        const { staffId } = req.params;
        const { organizationId } = req.user;

        const cleanedData = cleanData(req.body);
        const { email, password, ...updateData } = cleanedData;

        // const { email, password, organizationId, ...updateData } = cleanData(req.body);
        // await checkOrganization(organizationId);

        const staff = await Staff.findOne({ _id: staffId });
        if (!staff) return res.status(404).json({ message: 'Staff not found' });

        const { organizationExists, existingUser } = await dataExist( organizationId, email, null );   
        
        if (!validateDataExist( organizationExists, res )) return;

        // if (existingUser) return res.status(409).json({ message: 'User with this email already exists.' });
        
        if (!validateInputs( cleanedData, organizationExists, res)) return;
        
        if (email && email !== staff.email) {
            const emailExists = await Staff.findOne({ _id: { $ne: staffId }, organizationId, email });
            if (emailExists) return res.status(409).json({ message: 'Email already in use' });
            staff.email = email;
        }
        
        if (password) staff.password = await bcrypt.hash(password, 10);
        Object.assign(staff, updateData);
        await staff.save();
        
        res.status(200).json({ message: 'Staff updated successfully', staff });
    } catch (error) {
      console.error("Error in editStaff:", error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Get All Staff
exports.getAllStaff = async (req, res) => {
    try {
        const staffList = await Staff.find();
        res.status(200).json(staffList);
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Get One Staff
exports.getStaffById = async (req, res) => {
    try {
        const { staffId } = req.params;
        const staff = await fetchData(Staff, { _id: staffId });
        if (!staff) return res.status(404).json({ message: 'Staff not found' });
        res.status(200).json(staff);
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// Delete Staff
exports.deleteStaff = async (req, res) => {
    try {
        const { staffId } = req.params;
        const staff = await Staff.findByIdAndDelete(staffId);
        if (!staff) return res.status(404).json({ message: 'Staff not found' });
        
        res.status(200).json({ message: 'Staff deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};










// Validate Organization Tax Currency
function validateDataExist( organizationExists, res ) {
    if (!organizationExists) {
      res.status(404).json({ message: "Organization not found" });
      return false;
    }
    return true;
  }





//Validate inputs
function validateInputs( data, organizationExists, res) {
    const validationErrors = validateData(data, organizationExists );
  
    if (validationErrors.length > 0) {
      res.status(400).json({ message: validationErrors.join(", ") });
      return false;
    }
    return true;
}


function validateData( data, organizationExists ) {
    const errors = [];

  
    //Basic Info
    validateReqFields( data );

    
    //OtherDetails
    //validateAlphanumericFields([''], data, errors);
    validateIntegerFields([''], data, errors);
    validateFloatFields([''], data, errors);
    //validateAlphabetsFields([''], data, errors);
  
    return errors;
  }
  




// Field validation utility
function validateField(condition, errorMsg, errors) {
    if (condition) errors.push(errorMsg);
  }



function validateReqFields( data, errors ) {
  validateField( typeof data.staffName === 'undefined', "Please enter the staff name.", errors  );
  

}
    








  //Valid Alphanumeric Fields
function validateAlphanumericFields(fields, data, errors) {
    fields.forEach((field) => {
      validateField(data[field] && !isAlphanumeric(data[field]), "Invalid " + field + ": " + data[field], errors);
    });
  }
  // Validate Integer Fields
  function validateIntegerFields(fields, data, errors) {
  fields.forEach(field => {
    validateField(data[field] && !isInteger(data[field]), `Invalid ${field}: ${data[field]}`, errors);
  });
  }
  //Valid Float Fields  
  function validateFloatFields(fields, data, errors) {
    fields.forEach((balance) => {
      validateField(data[balance] && !isFloat(data[balance]),
        "Invalid " + balance.replace(/([A-Z])/g, " $1") + ": " + data[balance], errors);
    });
  }
  //Valid Alphabets Fields 
  function validateAlphabetsFields(fields, data, errors) {
    fields.forEach((field) => {
      if (data[field] !== undefined) {
        validateField(!isAlphabets(data[field]),
          field.charAt(0).toUpperCase() + field.slice(1) + " should contain only alphabets.", errors);
      }
    });
  }