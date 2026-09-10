const fs = require("fs");

// Authentication belongs to persistent site data, never to an image default.
const file = process.env.NODE_RED_AUTH_FILE || "/data/node-red/admin-auth.json";
let config;
try {
  config = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (_) {
  throw new Error("Provision a valid persistent Node-RED admin-auth.json before startup");
}

const users = config && config.users;
const names = new Set();
if (!Array.isArray(users) || users.length === 0) {
  throw new Error("Node-RED authentication requires at least one configured user");
}
for (const user of users) {
  if (!user || typeof user.username !== "string" || !user.username.trim() ||
      user.username !== user.username.trim() || names.has(user.username) ||
      typeof user.password !== "string" ||
      !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(user.password) ||
      !["*", "read"].includes(user.permissions)) {
    throw new Error("Node-RED authentication requires unique users, bcrypt hashes and explicit permissions");
  }
  const cost = Number(user.password.slice(4, 6));
  if (cost < 4 || cost > 31) throw new Error("Invalid bcrypt work factor");
  names.add(user.username);
}

module.exports = {
  type: "credentials",
  users: users.map(({ username, password, permissions }) => ({ username, password, permissions })),
};
