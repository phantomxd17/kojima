var admin = require("firebase-admin");

var serviceAccount = require("./fireKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "gs://project5-1a5d6.appspot.com",
});

module.exports = admin;