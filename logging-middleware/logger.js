require("dotenv").config();

const axios = require("axios");

const BASE_URL = process.env.BASE_URL;
const TOKEN = process.env.ACCESS_TOKEN;

async function log(stack, level, packageName, message) {
    try {

        const response = await axios.post(
            `${BASE_URL}/logs`,
            {
                stack,
                level,
                package: packageName,
                message
            },
            {
                headers: {
                    Authorization: `Bearer ${TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log("Log Success:", response.data);

    } catch (err) {

        console.log("========== ERROR ==========");

        console.log(err);

        console.log("===========================");
    }
}

module.exports = log;