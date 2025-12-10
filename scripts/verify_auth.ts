import dotenv from "dotenv";
import {config} from "../src/config";

dotenv.config();

const PORT = config.port;
const URL = `http://localhost:${PORT}/api/auth/login`;

const username = config.adminInitUser;
const password = config.adminInitPass;

console.log(`Target URL: ${URL}`);
console.log(`Trying to login with User: "${username}"`);

async function testLogin() {
    try {
        const response = await fetch(URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({username, password})
        });

        const data = await response.json();

        console.log("\n--- Server Response ---");
        console.log(`Status: ${response.status} ${response.statusText}`);
        console.log("Body:", JSON.stringify(data, null, 2));

        if (response.ok) {
            console.log("\n認証成功！ (Authentication Successful)");
        } else {
            console.log("\n認証失敗 (Authentication Failed)");
            console.log("Check your username/password in .env file.");
        }

    } catch (error) {
        console.error("\n通信エラー (Connection Error)");
        console.error(error);
    }
}

testLogin();
