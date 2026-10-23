const mysql = require('mysql2/promise');
function createPool() {
  if (process.env.MYSQL_URL) return mysql.createPool(process.env.MYSQL_URL);
  const host = process.env.MYSQLHOST || process.env.MYSQL_HOST;
  const user = process.env.MYSQLUSER || process.env.MYSQL_USER;
  const password = process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD;
  const database = process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE;
  const port = Number(process.env.MYSQLPORT || process.env.MYSQL_PORT || 3306);
  if (!host || !user || !database) throw new Error('Configure MYSQL_URL ou MYSQLHOST, MYSQLUSER e MYSQLDATABASE.');
  return mysql.createPool({host, port, user, password, database, waitForConnections:true, connectionLimit:10, queueLimit:0, charset:'utf8mb4'});
}
module.exports = { createPool };
