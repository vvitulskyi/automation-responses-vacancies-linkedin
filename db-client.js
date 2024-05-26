require("dotenv").config();
const { MongoClient } = require("mongodb");

const DB_URL = process.env.DB_URL;
const CLIENT = new MongoClient(DB_URL);
const DB = CLIENT.db("vacancies");

module.exports = { CLIENT, DB };
