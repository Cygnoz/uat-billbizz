// v1.0

const mongoose = require("mongoose");
const { Schema } = mongoose;


const staffSchema = new Schema({
  organizationId: { type: String },

  staffName: { type: String },
  staffImage: { type: String },

  proofImage: { type: String },
  documentNumber: { type: String },
  uploadDocument: { type: String },

  gender: { type: String },
  location: { type: String },
  contact: { type: String },

  department: { type: String },
  designation: { type: String },

  email: { type: String },
  password: { type: String },

  address: { type: String },
  dob: { type: String },
  doj: { type: String },
  
  role: { type: String },

  employeeId: { type: String },

  workType: { type: String }, //role


  paymentType: { type: String },//Monthly , per week
  salary: { type: String }

  // service: { type: String }, 
});

const Staff = mongoose.model("Staff", staffSchema);

module.exports = Staff;