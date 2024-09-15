
const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { networkInterfaces } = require('os');
const { exec } = require('child_process');
const util = require('util');
const { Console } = require('console');


const PORT = process.env.PORT || 8001;
// Get local IP addresses
const getLocalIPAddresses = () => {
  const interfaces = networkInterfaces();
  const addresses = [];

  for (const key in interfaces) {
    for (const iface of interfaces[key]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }

  return addresses;
};

const app = express();

app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  key: "userId",
  secret: "atanu",
  resave: false,
  saveUninitialized: false,
}));

const db = mysql.createConnection({
  host: '127.0.0.1',
  user: 'root',
  password: '',
  database: 'invitation_package_msdb',
  port: '3307'
});
app.post("/login", (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  // Log basic information
  const logInfo = {
    timestamp: new Date().toISOString(),
    username,
    ip_address: req.ip,
    result: '',
    Roles: '',
    session_id: '',
  };

  let sql = `SELECT username, password, Roles FROM users WHERE username='${username}'`;

  db.query(sql, (err, result) => {
    if (err) {
      console.log(err);
      res.status(500).send({ login: false, msg: "Internal Server Error" });
    } else {
      if (result.length > 0) {
        if (password === result[0].password) {
          req.session.user = result;

          // Include the user's role in the response
          const userRole = result[0].Roles;
          console.log('User Role: ' + userRole);
          const sessionToken = Math.random().toString(36).substring(2);
          req.session.sessionToken = sessionToken;
          logInfo.Roles = userRole;
          logInfo.session_id = sessionToken;
          logInfo.result = 'Success';
          res.send({ login: true, username: username, Roles: userRole });

        } else {
          logInfo.result = 'Failed';
          logInfo.failure_reason = 'Wrong Password';
          res.send({ login: false, msg: "Wrong Password" });
        }
      } else {
        logInfo.result = 'Failed';
        logInfo.failure_reason = 'User Email Not Exists';
        res.send({ login: false, msg: "User Email Not Exists" });
      }

      // Log the login attempt into the database
      db.query('INSERT INTO login_logs SET ?', logInfo, (error, results) => {
        if (error) {
          console.error('Error inserting log into database:', error);
        } else {
          console.log('Log inserted into the database');
        }
      });
    }
  });
});


const queryAsync = util.promisify(db.query).bind(db);

app.get("/login", (req, res) => {
  if (req.session.user) {
    res.send({ login: true, user: req.session.user });
  } else {
    res.send({ login: false });
  }
});

app.post("/", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error during logout:', err);
      res.status(500).send({ success: false, msg: "Internal Server Error" });
    } else {
      res.send({ success: true });
    }
  });
});
app.post("/submit", async (req, res) => {
  const { employeeId, selectedDate, rows, cols } = req.body;
  const selectQuery = 'SELECT CouponLeft FROM employeescouponhistory WHERE EmID = ?';

  let RestCol = 0;
  db.query(selectQuery, [employeeId], async (err, result) => {
    if (err) {
      console.error('UserID Not Found:', err);
      // Handle the error appropriately
    } else {
      const couponLeftValues = result.map((row) => parseInt(row.CouponLeft, 10));

      if (couponLeftValues.length === 0) {
        console.log('Employee ID Not Found.');
        res.status(404).send({ success: false, msg: "Employee ID Not Found" });
      } else {

        const couponLeft = couponLeftValues[0];

        if (couponLeft < cols) {
          console.log('Out Of Coupons');
          res.status(400).send({ success: false, msg: "Out Of Coupons" });
        } else {
          RestCol = couponLeft - cols;

          // Update the CouponLeft column in employeescouponhistory
          const updateCouponLeftQuery = 'UPDATE employeescouponhistory SET CouponLeft = ? WHERE EmID = ?';
          db.query(updateCouponLeftQuery, [RestCol, employeeId], async (updateError, updateResult) => {
            if (updateError) {
              console.error('Error updating CouponLeft:', updateError);
              res.status(500).send({ success: false, msg: "Internal Server Error" });
            } else {
              console.log('CouponLeft updated successfully');

              // Continue with the insert logic...
              // Assuming you have a table named 'employeesguesthistory' with columns 'EmID', 'Date', 'FullName', 'Status'
              const insertQuery = `INSERT INTO employeesguesthistory (EmID, Date, FullName, Status, CouponUsed) VALUES (?, ?, ?, 'Request', ?)`;

              const uniqueFullNames = [...new Set(rows.map((row) => row.fullName))];
              const insertPromises = uniqueFullNames.map((fullName) => {
                const values = [employeeId, selectedDate, fullName, 1];

                return new Promise((resolve, reject) => {
                  db.query(insertQuery, values, (err, result) => {
                    if (err) {
                      console.error('Error inserting data to the database:', err);
                      reject(err);
                    } else {
                      console.log('Coupon Request Sent!');
                      resolve(result);
                    }
                  });
                });
              });

              try {
                await Promise.all(insertPromises);
                res.send({ success: true, msg: "Request Sent successfully!", restCol: RestCol });
                console.log('Left Coupons: ' + RestCol);
              } catch (error) {
                console.error('Error inserting data to the database:', error);
                res.status(500).send({ success: false, msg: "Internal Server Error" });
              }
            }
          });
        }
      }
    }
  });
});


app.post("/search", (req, res) => {
  const { employeeId } = req.body;

  // Assuming your table is named 'employeesguesthistory'
  const selectQuery = `SELECT FullName, No FROM employeesguesthistory WHERE EmID = ? AND Status = 'Request'`;

  db.query(selectQuery, [employeeId], (err, result) => {
    if (err) {
      console.log(err);
      res.status(500).send({ rows: [] });
      console.log('Employee ID Not Found.')
    } else {
      const rows = result.map((row) => ({ fullName: row.FullName, Nos: row.No }));
      res.send({ rows });
    }
  });
});

app.post("/deleteEmployee", async (req, res) => {
  const { Nos, fullName, employeeId } = req.body;

  try {
    // Increment the CouponLeft value by 1 in the employeescouponhistory table
    await executeQuery('UPDATE employeescouponhistory SET CouponLeft = CouponLeft + 1 WHERE EmID = ?', [employeeId]);

    // Delete the employee record from the employeesguesthistory table
    await executeQuery('DELETE FROM employeesguesthistory WHERE No = ? ', [Nos]);

    console.log("Employee deleted successfully");
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting employee:", error);
    res.status(500).json({ success: false });
  }
});




app.post("/updateEmployee", (req, res) => {
  const { Nos, fullName, employeeId } = req.body;

  const updateQuery = `UPDATE employeesguesthistory SET FullName = ? WHERE EmID = ? AND No = ?`;

  db.query(updateQuery, [fullName, employeeId, Nos], (err, result) => {
    if (err) {
      console.error("Error updating employee:", err);
      res.status(500).send({ error: "Internal Server Error" });
    } else {
      console.log("Employee updated successfully");
      res.status(200).send({ success: true });
    }
  });
});

app.post('/couponCheck', async (req, res) => {
  const moment = require('moment');
  const { employeeId } = req.body;

  try {
    // Execute the queries
    const Usedresults = await executeQuery('SELECT Date, CouponUsed FROM employeesguesthistory WHERE EmID = ? AND Status = "Used"', [employeeId]);
    const Requestresults = await executeQuery('SELECT Date, CouponUsed FROM employeesguesthistory WHERE EmID = ? AND Status = "Request"', [employeeId]);
    const result1 = await executeQuery('SELECT CouponLeft FROM employeescouponhistory WHERE EmID = ?', [employeeId]);
    const result2 = await executeQuery('SELECT CouponUsed FROM employeesguesthistory WHERE EmID = ? AND Status="Used"', [employeeId]);
    const result3 = await executeQuery('SELECT CouponUsed FROM employeesguesthistory WHERE EmID = ? AND Status="Request"', [employeeId]);
    const result4 = await executeQuery(`
      SELECT Date, COUNT(*) AS count1
      FROM employeesguesthistory
      WHERE EmID = ? AND Status = 'Request'
      GROUP BY Date`, [employeeId]);
    const result5 = await executeQuery(`
      SELECT Date, COUNT(*) AS count2
      FROM employeesguesthistory
      WHERE EmID = ? AND Status = 'Used'
      GROUP BY Date`, [employeeId]);
      
    const couponUsedByDate = {};
    const couponREQUESTByDate = {};



    // Process result4 and result5 to organize the data
    const requestedCounts = result4.map(row => ({ date: row.Date, count: row.count1 }));
    const usedCounts = result5.map(row => ({ date: row.Date, count: row.count2 }));

    // Count the number of iterations where CouponUsed is not null in result2
    let couponUsedCount = 0;
    if (result2.length > 0) {
      for (const row of result2) {
        if (row.CouponUsed !== null) {
          couponUsedCount++;
        }
      }
    }

    // Count the number of iterations where CouponUsed is not null in result3
    let couponRequestedCount = 0;
    if (result3.length > 0) {
      for (const row of result3) {
        if (row.CouponUsed !== null) {
          couponRequestedCount++;
        }
      }
    }
    // Process USED query 
    Usedresults.forEach(row => {
      const { Date, CouponUsed } = row;

      // Convert the Date to the desired format '2024-03-18'
      const formattedDate = moment(Date).format('YYYY-MM-DD');

      // If the date is already in the object, add the CouponUsed to the existing sum
      if (couponUsedByDate[formattedDate]) {
        couponUsedByDate[formattedDate] += parseInt(CouponUsed); // Ensure CouponUsed is parsed as integer for addition
      } else {
        // Otherwise, initialize the sum with CouponUsed value
        couponUsedByDate[formattedDate] = parseInt(CouponUsed); // Ensure CouponUsed is parsed as integer for initialization
      }
    });

    // Process Request query 
    Requestresults.forEach(row => {
      const { Date, CouponUsed } = row;

      // Convert the Date to the desired format '2024-03-18'
      const formattedDate = moment(Date).format('YYYY-MM-DD');

      // If the date is already in the object, add the CouponUsed to the existing sum
      if (couponREQUESTByDate[formattedDate]) {
        couponREQUESTByDate[formattedDate] += parseInt(CouponUsed); // Ensure CouponUsed is parsed as integer for addition
      } else {
        // Otherwise, initialize the sum with CouponUsed value
        couponREQUESTByDate[formattedDate] = parseInt(CouponUsed); // Ensure CouponUsed is parsed as integer for initialization
      }
    });


    // Construct the response object
    const response = {
      couponLeft: result1.length > 0 ? result1[0].CouponLeft : null,
      couponUsed: couponUsedCount,
      couponRequested: couponRequestedCount,
      requestedCounts,
      usedCounts,
      couponUsedByDate,
      couponREQUESTByDate
    };



    // console.log(couponREQUESTByDate);
    // console.log(response);

    res.json(response);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});



// Function to execute a single SQL query
function executeQuery(query, values) {
  return new Promise((resolve, reject) => {
    db.query(query, values, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

app.post('/Guestsearch', async (req, res) => {
  const { employeeId } = req.body;

  // Assuming your table is named 'employeesguesthistory'
  //const searchQuery = 'SELECT FullName, Date FROM employeesguesthistory WHERE EmID = ? AND Status = "Request"';
  const searchQuery = 'SELECT FullName, DATE_FORMAT(Date, "%Y-%m-%d") AS Date FROM employeesguesthistory WHERE EmID = ? AND Status = "Request"';

  db.query(searchQuery, [employeeId], (err, result) => {
    if (err) {
      console.error('Error searching data in the database:', err);
      res.status(500).send({ success: false, msg: 'Internal Server Error' });
    } else {
      if (result.length > 0) {
        // Extracting only the desired columns (fullName and date)
        const selectedColumns = result.map(({ FullName, Date }) => ({ FullName, Date }));
        res.send({ success: true, rows: selectedColumns });
      } else {
        res.send({ success: true, rows: [] }); // No matching rows found
      }
    }
  });
});

// Add the following endpoint for updating status
app.post('/updateStatus', async (req, res) => {
  const dataToUpdate = req.body.data;

  // Assuming your table is named 'employeesguesthistory'
  const updateStatusQuery = 'UPDATE employeesguesthistory SET Status = "Used" WHERE EmID = ? AND FullName = ?';

  const updatePromises = dataToUpdate.map((data) => {
    const { employeeId, FullName } = data;

    console.log('Updating status for:', employeeId, FullName);

    return new Promise((resolve, reject) => {
      db.query(updateStatusQuery, [employeeId, FullName], (err, result) => {
        if (err) {
          console.error('Error updating status in the database:', err);
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  });

  try {
    await Promise.all(updatePromises);
    res.send({ success: true, msg: 'Status updated successfully!' });
  } catch (error) {
    console.error('Error updating status in the database:', error);
    res.status(500).send({ success: false, msg: 'Internal Server Error' });
  }
});

// Assuming you have an '/changepassword' endpoint in your Express app
app.post('/changepassword', async (req, res) => {
  const { username, oldPassword, newPassword } = req.body;

  // Check if the old password matches the one in the database
  const checkPasswordQuery = 'SELECT * FROM users WHERE username = ? AND password = ?';
  db.query(checkPasswordQuery, [username, oldPassword], (err, result) => {
    if (err) {
      console.error('Error checking old password:', err);
      res.status(500).send({ success: false, msg: 'Internal Server Error' });
    } else {
      if (result.length > 0) {
        // Old password is correct, proceed to update the password
        const updatePasswordQuery = 'UPDATE users SET password = ? WHERE username = ?';
        db.query(updatePasswordQuery, [newPassword, username], (err) => {
          if (err) {
            console.error('Error updating password:', err);
            res.status(500).send({ success: false, msg: 'Internal Server Error' });
          } else {
            res.send({ success: true, msg: 'Password updated successfully!' });
          }
        });
      } else {
        // Old password is incorrect
        res.send({ success: false, msg: 'Incorrect old password' });
      }
    }
  });
});


app.post('/exportDatabase', (req, res) => {
  const { fileName } = req.body; // Get the file name from the request body
  const databaseName = 'invitation_package_msdb';
  const password = 'ebu'; // Replace 'your_password' with your actual MySQL root password
  const fs = require('fs');
  const path = require('path');

  if (!fileName) {
    return res.status(400).send('Bad Request: File name is required');
  }

  exec(`mysqldump -u ipmsdb -p${password} ${databaseName} > ${fileName}.sql`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error during database export: ${stderr}`);
      res.status(500).send('Internal Server Error');
    } else {
      console.log(`Database exported successfully to ${fileName}`);
      res.download(`${fileName}.sql`, `"${fileName}.sql"`, (downloadError) => {
        if (downloadError) {
          console.error(`Error during download: ${downloadError}`);
          res.status(500).send('Internal Server Error');
        } else {
          // Cleanup: Delete the exported file after download
          const filePath = path.resolve(`${fileName}.sql`);
          fs.unlink(filePath, (unlinkError) => {
            if (unlinkError) {
              console.error(`Error during cleanup: ${unlinkError}`);
            } else {
              console.log(`Cleanup: ${fileName} deleted`);
            }
          });
        }
      });
    }
  });
});


// Search for visitors based on the date range
app.post('/searchVisitors', (req, res) => {
  const { fromDate, toDate } = req.body;

  // SQL query to fetch visitors between the specified dates with 'Status' column equal to 'Used'
  const sql = `SELECT FullName, EmID, DATE_FORMAT(Date, '%Y-%m-%d') AS FormattedDate FROM employeesguesthistory WHERE Date >= ? AND Date <= ? AND Status = 'Used'`;

  // Execute the query
  db.query(sql, [fromDate, toDate], (err, results) => {
    if (err) {
      console.error('Error searching visitors:', err);
      res.status(500).send('Internal Server Error');
    } else {
      // Map over the results and format the date in each record
      const formattedResults = results.map(result => ({
        FullName: result.FullName,
        EmID: result.EmID,
        Date: result.FormattedDate  // Use the formatted date
      }));

      res.json(formattedResults);
    }
  });
});
// Search for visitors based on the date range
app.post('/NotStaffsearchVisitors', (req, res) => {

  // SQL query to fetch visitors between the specified dates with 'Status' column equal to 'Used'
  const sql = `SELECT Org, DATE_FORMAT(Date, '%Y-%m-%d') AS FormattedDate, Remarks, TotalVis FROM free_visitors`;

  // Execute the query
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error searching visitors:', err);
      res.status(500).send('Internal Server Error');
    } else {
      // Map over the results and format the date in each record
      const formattedResults = results.map(result => ({
        Org: result.Org,
        Date: result.FormattedDate,
        TotalVis: result.TotalVis,
        Remarks: result.Remarks

      }));
      res.json(formattedResults);
    }
  });
});
app.post('/resetDatabase', (req, res) => {
  // Implement logic to update the 'employeescouponhistory' table
  const sql = 'UPDATE employeescouponhistory SET CouponLeft = 5, CouponUsed = 0';

  db.query(sql, (err, result) => {
    if (err) {
      console.error('Error resetting database:', err);
      res.json({ success: false });
    } else {
      console.log('Database reset successful');
      res.json({ success: true });
    }
  });
});

app.post('/addUsers', async (req, res) => {
  const defco = 5;
  try {
    const { users } = req.body;


    // Iterate through each user and insert into the database
    for (const user of users) {

      const { employeeId, employeeName } = user;

      // Replace the following query with the actual query for your database
      const query = `
              INSERT INTO employeescouponhistory (EmName, EmID, CouponLeft)
              VALUES (?, ?, ?)
          `;

      // Execute the query
      await db.query(query, [employeeId, employeeName, defco]);
    }

    // Respond with a success message
    res.json({ msg: 'Users added to employeescouponhistory successfully!' });
  } catch (error) {
    console.error('Error adding users to employeescouponhistory:', error);
    res.status(500).json({ msg: 'An error occurred while adding users.' });
  }
});

// Search for a user by employeeId
app.post('/searchUser', (req, res) => {
  const { employeeId } = req.body;
  const query = `SELECT EmName FROM employeescouponhistory WHERE EmID = ?`;

  // Replace 'YourDatabaseConnection' and 'YourDatabaseQuery' with your actual database connection and query logic
  db.query(query, [employeeId], (error, results, fields) => {
    if (error) {
      console.error('Error searching for user:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      // Log the found user data on the server console
      console.log('Found user:', results[0] || null);

      // Respond with the found user data
      res.json({ user: results[0] || null });
    }
  });
});


app.delete('/deleteUser', (req, res) => {
  const employeeId = req.query.employeeId; // Use req.query for query parameters

  // Perform a database query to delete the user by employeeId
  const query = 'DELETE FROM employeescouponhistory WHERE EmID = ?';

  // Replace 'YourDatabaseConnection' with your actual database connection
  db.query(query, [employeeId], (error, results, fields) => {
    if (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      // Respond with a success message
      res.json({ msg: 'User deleted successfully!' });
    }
  });
});
// Update user information by employeeId
// Update user by EmID
app.post('/updateUser', (req, res) => {

  const { employeeId, updatedEmName, updatedEmID } = req.body;
  const query = 'UPDATE employeescouponhistory SET EmName = ?, EmID = ? WHERE EmID = ?';
  console.log(updatedEmID + employeeId)
  db.query(query, [updatedEmName, updatedEmID, employeeId], (error) => {
    if (error) {
      console.error('Error updating user:', error);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    } else {
      res.json({ success: true });
    }
  });
});

// Search for a user by employeeId
app.post('/CosearchUser', (req, res) => {
  const { employeeId } = req.body;
  const query = 'SELECT EmID, EmName FROM employeescouponhistory WHERE EmID = ?';

  db.query(query, [employeeId], (error, results) => {
    if (error) {
      console.error('Error searching for user:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      // Respond with the found user data
      res.json({ user: results[0] || null });
    }
  });
});
// Endpoint to handle adding a new system user
app.post('/addSysUser', (req, res) => {
  const { username, password, EmployeeID, role } = req.body;

  // Implement logic to add a new user to the 'users' table
  const query = 'INSERT INTO users (username, password,EmployeeID, Roles) VALUES (?, ?, ?, ?)';

  db.query(query, [username, password, EmployeeID, role], (error, results) => {
    if (error) {
      console.error('Error adding system user:', error);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    } else {
      res.json({ success: true });
    }
  });
});

// Search for a user by employeeId
app.post('/SysearchUser', (req, res) => {
  const { employeeId } = req.body;
  const query = 'SELECT username, Roles FROM users WHERE EmployeeID = ?';

  db.query(query, [employeeId], (error, results) => {
    if (error) {
      console.error('Error searching for user:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      res.json({ user: results[0] || null });
    }
  });
});

// Delete a user by employeeId
app.post('/SysdeleteUser', (req, res) => {
  const { employeeId } = req.body;
  const query = 'DELETE FROM users WHERE EmployeeID = ?';

  db.query(query, [employeeId], (error) => {
    if (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      res.json({ success: true });
    }
  });
});

// Search for a user by employeeId
app.post('/UpsearchUser', (req, res) => {
  const { employeeId } = req.body;
  const query = 'SELECT username, Roles, EmployeeID FROM users WHERE EmployeeID = ?';

  db.query(query, [employeeId], (error, results) => {
    if (error) {
      console.error('Error searching for user:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      res.json({ user: results[0] || null });
    }
  });
});
app.post('/UpupdateUser', async (req, res) => {
  const { updatedUserName, updatedUserId, updatedRole } = req.body;

  try {
    // Execute the SQL UPDATE query to update the user record
    const query = `
      UPDATE users
      SET username = ?,
          Roles = ?
      WHERE EmployeeID = ?
    `;
    await executeQuery(query, [updatedUserName, updatedRole, updatedUserId]);
    console.log('User Updated')
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});
app.get('/getRequestCount', (req, res) => {
  // Get the current date
  const currentDate = new Date().toISOString().split('T')[0];

  // Query to count requests for the current date with status 'Request' for different EmID
  const query = `
    SELECT COUNT(DISTINCT EmID) AS requestCount 
    FROM employeesguesthistory 
    WHERE Date = ? AND Status = 'Request'
    GROUP BY EmID`;

  // Execute the query
  db.query(query, [currentDate], (error, results) => {
    if (error) {
      console.error('Error fetching request count:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    // Extract the count from the results
    const requestCount = results.length; // Length of the results array gives the count

    // Send the count as JSON response
    res.json({ count: requestCount });
  });
});

app.get('/GuestgetRequestCount', (req, res) => {
  // Get the current date
  const currentDate = new Date().toISOString().split('T')[0];

  // Query to count requests for the current date with status 'Request' for different EmID
  const query = `
    SELECT COUNT(DISTINCT EmID) AS requestCount 
    FROM employeesguesthistory 
    WHERE Date = ? AND AutLev = 'Approved By Ticketer'
    GROUP BY EmID`;

  // Query to count rows in free_visitors table where Date equals current date
  const query1 = 'SELECT COUNT(*) AS rowCount FROM free_visitors WHERE Date = ?';

  // Execute both queries
  db.query(query, [currentDate], (error, results) => {
    if (error) {
      console.error('Error fetching request count:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    // Extract the count from the results
    const requestCount = results.length; // Length of the results array gives the count

    // Execute the second query
    db.query(query1, [currentDate], (error, rows) => {
      if (error) {
        console.error('Error fetching row count:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
      }

      // Extract the row count from the results
      const rowCount = rows[0].rowCount;

      // Send both counts as JSON response
      res.json({ requestCount: requestCount, rowCount: rowCount });
    });
  });
});


app.get('/getReqEmployeeData', (req, res) => {
  // Get today's date
  const currentDate = new Date().toISOString().split('T')[0];
  const st = 'Request';
  // Query to fetch FullName and Status where Date is today's date
  const query = 'SELECT FullName, Status, EmID, No FROM employeesguesthistory WHERE Date = ? And Status = ? ';

  db.query(query, [currentDate, st], (error, results) => {
    if (error) {
      console.error('Error fetching employee data:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    const employeeData = results.map(result => ({
      FullName: result.FullName,
      Status: result.Status,
      EmID: result.EmID,
      No: result.No
    }));
    // Send the data to the client
    res.json(employeeData);
  });
});
app.get('/StaffgetReqEmployeeData', (req, res) => {
  // Get today's date
  const currentDate = new Date().toISOString().split('T')[0];
  const st = 'Approved By Ticketer';
  // Query to fetch FullName and Status where Date is today's date
  const query = 'SELECT FullName, Status, EmID FROM employeesguesthistory WHERE Date = ? And AutLev = ? ';

  db.query(query, [currentDate, st], (error, results) => {
    if (error) {
      console.error('Error fetching employee data:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    const employeeData = results.map(result => ({
      FullName: result.FullName,
      Status: result.Status,
      EmID: result.EmID
    }));
    // Send the data to the client
    res.json(employeeData);
  });
});

// POST endpoint to handle request approval
app.post('/approveRequest', (req, res) => {
  const { emID, currentDate } = req.body;
  console.log("Employee ID: " + emID)

  // Update the employeesguesthistory table
  const sql = 'UPDATE employeesguesthistory SET Status = ?, AutLev = ? WHERE EmID = ? And Date = ?';
  const values = ['Used', 'Approved By Ticketer', emID, currentDate];

  // Execute the SQL query
  db.query(sql, values, (err, result) => {
    if (err) {
      console.error('Error updating request:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    // Check if any rows were affected
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Send success response
    res.json({ message: 'Request approved successfully' });
  });
});

app.get('/getFreeVisitorsData', (req, res) => {
  // Get the current date
  const currentDate = new Date().toISOString().split('T')[0];

  // Query to fetch 'Org' and 'TotalVis' where 'Date' equals the current date
  const query = 'SELECT Org, TotalVis,Remarks FROM free_visitors WHERE Date = ?';

  // Execute the query
  db.query(query, [currentDate], (error, results) => {
    if (error) {
      console.error('Error fetching free visitors data:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    console.log(results)
    // Send the data to the client
    res.json(results);
  });
});

// POST endpoint to handle request approval
app.post('/SecStaffapproveRequest', (req, res) => {
  const { emID } = req.body;
  console.log("Employee ID: " + emID)
  const currentDate = new Date().toISOString().split('T')[0];


  // Update the employeesguesthistory table
  const sql = 'UPDATE employeesguesthistory SET AutLev = ? WHERE EmID = ? And Date = ?';
  const values = ['Approved By Both', emID, currentDate];

  // Execute the SQL query
  db.query(sql, values, (err, result) => {
    if (err) {
      console.error('Error updating request:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    // Check if any rows were affected
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Send success response
    res.json({ message: 'Request approved successfully' });
  });
});

// Route to handle adding free visitors
app.post('/addFreeVisitor', (req, res) => {
  const visitors = req.body;

  if (!visitors || !Array.isArray(visitors) || visitors.length === 0) {

    return res.status(400).json({ error: 'Invalid data format' });
  }

  const values = visitors.map(visitor => [
    visitor.organization,
    visitor.date,
    visitor.numOfVisitors,
    visitor.remarks
  ]);
  console.log(values);

  const query = 'INSERT INTO free_visitors (Org, Date, TotalVis, Remarks) VALUES ?';

  db.query(query, [values], (err, result) => {
    if (err) {
      console.error('Error inserting free visitors:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    console.log('Inserted free visitors:', result.affectedRows);
    res.json({ message: 'Data inserted successfully' });
  });
});

app.post('/searchresult', (req, res) => {
  // Extract 'fromDate' and 'toDate' from the request body
  const { fromDate, toDate } = req.body;

  // SQL queries to fetch the required data
  const query1 = 'SELECT COUNT(*) AS usedCount FROM employeesguesthistory WHERE Date BETWEEN ? AND ? AND Status = ?';
  const query2 = 'SELECT COUNT(DISTINCT EmID) AS distinctEmIDs FROM employeesguesthistory WHERE Date BETWEEN ? AND ? AND Status = ?';
  const query3 = 'SELECT COUNT(*) AS couponCount FROM employeescouponhistory';
  const query4 = 'SELECT SUM(TotalVis) AS totalSum FROM free_visitors';


  // Execute the queries
  db.query(query1, [fromDate, toDate, 'Used'], (error1, results1) => {
    if (error1) {
      console.error('Error fetching used count:', error1);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    db.query(query2, [fromDate, toDate, 'Used'], (error2, results2) => {
      if (error2) {
        console.error('Error fetching distinct EmIDs:', error2);
        return res.status(500).json({ error: 'Internal Server Error' });
      }
      db.query(query4, [fromDate, toDate, 'Used'], (error2, results4) => {
        if (error2) {
          console.error('Error fetching distinct EmIDs:', error2);
          return res.status(500).json({ error: 'Internal Server Error' });
        }
        db.query(query3, (error3, results3) => {
          if (error3) {
            console.error('Error fetching coupon count:', error3);
            return res.status(500).json({ error: 'Internal Server Error' });
          }

          // Extract data from results
          const usedCount = results1[0].usedCount;
          const distinctEmIDs = results2[0].distinctEmIDs;
          const couponCount = results3[0].couponCount;
          const totalSum = results4[0].totalSum;


          // Calculate the desired reports
          const report3 = couponCount - distinctEmIDs;
          const finalReport = (distinctEmIDs + report3) * 5;
          console.log(usedCount,
            distinctEmIDs,
            report3,
            finalReport,
            totalSum)
          // Send the calculated reports as JSON response
          res.json({
            usedCount,
            distinctEmIDs,
            report3,
            finalReport,
            totalSum
          });
        });
      });
    });
  });
});

// Route to fetch data from employeesguesthistory
app.get('/fetchData', (req, res) => {
  // Get the current date in 'YYYY-MM-DD' format
  const currentDate = new Date().toISOString().split('T')[0];

  // Query to fetch EmID and total sum of CouponUsed for each EmID
  const query = `
    SELECT EmID, SUM(CouponUsed) AS TotalSum
    FROM employeesguesthistory
    WHERE Date = ? AND AutLev = 'Approved By Both'
    GROUP BY EmID`;

  // Execute the query
  db.query(query, [currentDate], (error, results) => {
    if (error) {
      console.error('Error fetching data:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    console.log(results)
    res.json(results);
  });
});
// Route to fetch data from employeesguesthistory
app.get('/TicfetchData', (req, res) => {
  // Get the current date in 'YYYY-MM-DD' format
  const currentDate = new Date().toISOString().split('T')[0];

  // Query to fetch EmID and total sum of CouponUsed for each EmID
  const query = `
    SELECT EmID, SUM(CouponUsed) AS TotalSum
    FROM employeesguesthistory
    WHERE Date = ? AND AutLev = 'Approved By Ticketer'
    GROUP BY EmID`;

  // Execute the query
  db.query(query, [currentDate], (error, results) => {
    if (error) {
      console.error('Error fetching data:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    console.log(results)
    res.json(results);
  });
});
app.listen(PORT, () => {
  //const localIPAddresses = getLocalIPAddresses();
  console.log(`Server running on port ${PORT}`);
  // console.log('Server IP Address: '+localIPAddresses)
  const serverDateTime = new Date().toISOString();
  console.log('Server Date And Time: ' + serverDateTime)
});

