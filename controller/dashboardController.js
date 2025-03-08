const Customer = require("../database/model/customer");
const SalesInvoice = require("../database/model/salesInvoice");
const TrialBalance = require("../database/model/trialBalance");
const Accounts = require("../database/model/account");
const Organization = require("../database/model/organization");
const Item = require("../database/model/item");
const SalesReceipt = require('../database/model/salesReceipt');
const moment = require("moment-timezone");

const { singleCustomDateTime, multiCustomDateTime } = require("../services/timeConverter");


const dataExist = async ( organizationId, customerId ) => {    
  const [organizationExists, allInvoice, allReceipt ] = await Promise.all([
    Organization.findOne({ organizationId },{ timeZoneExp: 1, dateFormatExp: 1, dateSplit: 1, organizationCountry: 1 }).lean(),
    SalesInvoice.find({ organizationId, customerId })
    .populate('items.itemId', 'itemName') 
    .populate('customerId', 'customerDisplayName')    
    .lean(),
    SalesReceipt.find({ organizationId, customerId },{ customerId:1, paymentDate:1, paymentMode:1, amountReceived:1, receipt:1, createdDateTime:1})
    .populate('customerId', 'customerDisplayName')    
    .lean(),
  ]);
  return { organizationExists, allInvoice, allReceipt };
};



//Main Dash board
exports.getCustomerStats = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { date } = req.params;
    
    const givenDate = moment(date, "YYYY-MM-DD");
    const givenYear = givenDate.year();
    const givenMonth = givenDate.month() + 1; 
    const prevMonth = givenDate.subtract(1, "month").month() + 1;
    const prevYear = givenDate.year();

    // Total Customers (Current and Previous)
    const totalCustomers = await Customer.countDocuments({ organizationId });
    const prevTotalCustomers = await Customer.countDocuments({
      organizationId,
      createdDateTime: { $lt: moment(`${givenYear}-${givenMonth}-01`).startOf("month").toDate() }
    });

    // New Customers (Current and Previous)
    const newCustomers = await getCustomerCountForMonth(organizationId, givenYear, givenMonth);
    const prevNewCustomers = await getCustomerCountForMonth(organizationId, prevYear, prevMonth);

    // Active Customers (Current and Previous)
    const activeCustomers = await getActiveCustomerCountForMonth(organizationId, givenYear, givenMonth);
    const prevActiveCustomers = await getActiveCustomerCountForMonth(organizationId, prevYear, prevMonth);

    // Calculate Growth Rates
    const totalCustomerGrowth = calculateGrowth(totalCustomers, prevTotalCustomers);
    const newCustomerGrowth = calculateGrowth(newCustomers, prevNewCustomers);
    const activeCustomerGrowth = calculateGrowth(activeCustomers, prevActiveCustomers);

    // Customer Retention Rate (%) = (Previous Active Customers - New Customers) / Previous Active Customers * 100
    const customerRetentionRate = prevActiveCustomers === 0 ? 0 : ((prevActiveCustomers - newCustomers) / prevActiveCustomers) * 100;

    // Customer Churn Rate (%) = (Previous Active Customers - Current Active Customers) / Previous Active Customers * 100
    const customerChurnRate = prevActiveCustomers === 0 ? 0 : ((prevActiveCustomers - activeCustomers) / prevActiveCustomers) * 100;


    const topCustomersBySalesVolume = await topCustomerBySalesVolume(organizationId);
    // const customerRetentionRateOverTimeData = await customerRetentionRateOverTime(organizationId);
    const customerRetentionRateOverTimeData = await customerRetentionRateOverTime(organizationId, givenYear, givenMonth);


    // Send response
    res.status(200).json({
      totalCustomers,
      totalCustomerGrowth: totalCustomerGrowth.toFixed(2),
      newCustomers,
      newCustomerGrowth: newCustomerGrowth.toFixed(2),
      activeCustomers,
      activeCustomerGrowth: activeCustomerGrowth.toFixed(2),
      customerRetentionRate: customerRetentionRate.toFixed(2),
      customerChurnRate: customerChurnRate.toFixed(2),
      topCustomersBySalesVolume,
      customerRetentionRateOverTime: customerRetentionRateOverTimeData,
    });

  } catch (error) {
    res.status(500).json({ message: "Error fetching customer stats", error });
  }
};


// Get stats for a single customer
exports.getOneCustomerStats = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { customerId } = req.params;

    if (!customerId) {
      return res.status(400).json({ message: "Customer ID is required" });
    }

    const customerAccount = await Accounts.findOne({ organizationId, accountId : customerId });


    // Fetch Trial Balance records for the customer
    const trialBalances = await TrialBalance.find({ organizationId, accountId : customerAccount._id });

    // Calculate Total Payment (Sum of creditAmount)
    const totalPayment = trialBalances.reduce((sum, entry) => sum + (entry.creditAmount || 0), 0);

    // Calculate Outstanding Balance (Sum of debitAmount - Sum of creditAmount, min 0)
    const totalDebit = trialBalances.reduce((sum, entry) => sum + (entry.debitAmount || 0), 0);
    const outstandingBalance = Math.max(0, totalDebit - totalPayment);

    // Fetch total number of sales invoices for the customer
    const totalSales = await SalesInvoice.countDocuments({ organizationId, customerId });

    // Send response
    res.status(200).json({
      totalPayment,
      outstandingBalance,
      totalSales,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching customer stats", error });
  }
};


// Get customer sales history
exports.customerSaleHistory = async (req, res) => {
  try {
    const { customerId } = req.params; 
    const { organizationId } = req.user;


    const { organizationExists, allInvoice } = await dataExist( organizationId, customerId );


    if (!organizationExists) {
      return res.status(404).json({ message: "Organization not found" });
    }

    if (!allInvoice) {
      return res.status(404).json({ message: "No Invoice found" });
    }    
    
    const transformedInvoice = allInvoice.map(data => {
      return {
          ...data,
          customerId: data.customerId?._id,  
          customerDisplayName: data.customerId?.customerDisplayName,
          items: data.items.map(item => ({
            ...item,
            itemId: item.itemId?._id,
            itemName: item.itemId?.itemName,
          })),  
      };});

    const formattedObjects = multiCustomDateTime(transformedInvoice, organizationExists.dateFormatExp, organizationExists.timeZoneExp, organizationExists.dateSplit );

    res.status(200).json( formattedObjects );    
  } catch (error) {
    console.log(error);    
    return res.status(500).json({ message: "Error fetching sales history", error });
  }
};


// Get customer sales receipt
exports.customerSalesReceipt = async (req, res) => {
  try {
    const { customerId } = req.params; 

    const organizationId  = req.user.organizationId;

    const { organizationExists , allReceipt } = await dataExist( organizationId, customerId );

    if (!organizationExists) {
      return res.status(404).json({ message: "Organization not found" });
    }

    if (!allReceipt) {
      return res.status(404).json({ message: "No Payments found" });
    }
    
    const transformedInvoice = allReceipt.map(data => {
      return {
        ...data,
        customerId: data.customerId?._id,  
        customerDisplayName: data.customerId?.customerDisplayName,  
      };}); 
      
    const formattedObjects = multiCustomDateTime(transformedInvoice, organizationExists.dateFormatExp, organizationExists.timeZoneExp, organizationExists.dateSplit );    
      
    res.status(200).json(formattedObjects);

  } catch (error) {
    console.error("Error fetching purchase paymentMade:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};
























// get customer count for a given month
const getCustomerCountForMonth = async (organizationId, year, month) => {
  const startDate = moment(`${year}-${month}-01`).startOf("month").toDate();
  const endDate = moment(startDate).endOf("month").toDate();

  return await Customer.countDocuments({
    organizationId,
    createdDateTime: { $gte: startDate, $lte: endDate }
  });
};





// get active customer count
const getActiveCustomerCountForMonth = async (organizationId, year, month) => {
  const startDate = moment(`${year}-${month}-01`).startOf("month").toDate();
  const endDate = moment(startDate).endOf("month").toDate();

  return await Customer.countDocuments({
    organizationId,
    status: "Active",
    createdDateTime: { $lte: endDate } // Consider customers created before or within the month
  });
};





// calculate percentage growth
const calculateGrowth = (current, previous) => {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
};




// get top 5 customers by sales volume
const topCustomerBySalesVolume = async (organizationId) => {
  const customers = await Customer.find({ organizationId });

  const customerSales = await Promise.all(
    customers.map(async (customer) => {
      const customerAccount = await Accounts.findOne({ organizationId, accountId: customer._id });

      if (!customerAccount) return { customerId: customer._id, customerName: customer.customerDisplayName, saleVolume: 0 };
      
      const trialBalances = await TrialBalance.find({
        organizationId,
        accountId: customerAccount._id,
        action: "Sales Invoice",
      });
      console.log(trialBalances);
      
      
      const saleVolume = trialBalances.reduce((total, record) => total + record.debitAmount, 0);
      return { customerId: customer._id, customerName: customer.customerDisplayName, saleVolume };
    })
  );

  return customerSales.sort((a, b) => b.saleVolume - a.saleVolume).slice(0, 5);
};





// Function to compute customer retention rate over time
const customerRetentionRateOverTime = async (organizationId) => {
  const currentYear = moment().year();
  let retentionRates = [];

  for (let month = 0; month < 12; month++) {
    const startDate = moment({ year: currentYear, month, day: 1 }).startOf("month");
    const endDate = moment(startDate).endOf("month");
    const prevStartDate = moment(startDate).subtract(1, "months").startOf("month");
    const prevEndDate = moment(prevStartDate).endOf("month");

    const prevMonthActiveCustomers = await Customer.countDocuments({
      organizationId,
      status: "Active",
      createdDateTime: { $gte: prevStartDate.toDate(), $lte: prevEndDate.toDate() },
    });

    const currentMonthActiveCustomers = await Customer.countDocuments({
      organizationId,
      status: "Active",
      createdDateTime: { $gte: startDate.toDate(), $lte: endDate.toDate() },
    });

    const churnedCustomers = Math.max(0, prevMonthActiveCustomers - currentMonthActiveCustomers);
    const retentionRate = prevMonthActiveCustomers > 0
      ? ((prevMonthActiveCustomers - churnedCustomers) / prevMonthActiveCustomers) * 100
      : 0;

    retentionRates.push({ month: startDate.format("MMM"), rate: retentionRate });
  }

  return retentionRates;
};
// const customerRetentionRateOverTime = async (organizationId, year, month) => {
//   const daysInMonth = moment(`${year}-${month}`, "YYYY-MM").daysInMonth();
//   let retentionRates = [];

//   for (let day = 1; day <= daysInMonth; day++) {
//       const startDate = moment(`${year}-${month}-${day}`, "YYYY-MM-DD").startOf("day");
//       const endDate = moment(startDate).endOf("day");
//       const prevStartDate = moment(startDate).subtract(1, "day").startOf("day");
//       const prevEndDate = moment(prevStartDate).endOf("day");

//       // Count previous day's active customers
//       const prevDayActiveCustomers = await Customer.countDocuments({
//           organizationId,
//           status: "Active",
//           createdDateTime: { $lte: prevEndDate.toDate() } // All active customers up to previous day
//       });

//       console.log(`Day ${day - 1}: prevDayActiveCustomers:`, prevDayActiveCustomers);

//       // Count active customers for the current day
//       const currentDayActiveCustomers = await Customer.countDocuments({
//           organizationId,
//           status: "Active",
//           createdDateTime: { $lte: endDate.toDate() }
//       });

//       console.log(`Day ${day}: currentDayActiveCustomers:`, currentDayActiveCustomers);

//       const churnedCustomers = Math.max(0, prevDayActiveCustomers - currentDayActiveCustomers);
//       const retentionRate = prevDayActiveCustomers > 0
//           ? ((prevDayActiveCustomers - churnedCustomers) / prevDayActiveCustomers) * 100
//           : 0;

//       retentionRates.push({ day: day.toString(), rate: retentionRate });
//   }

//   return retentionRates;
// };

