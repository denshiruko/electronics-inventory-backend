import dotenv from "dotenv";
import path from "path";

dotenv.config();

function throwEnvError(key: string): never {
    throw new Error(`Configuration error: Environment variable ${key} is not set.`);
}

function getEnvOrThrow(key: string): string {
    const value = process.env[key];
    return (value === undefined || value === "") ? throwEnvError(key) : value;
}

function getEnv(key: string, defaultValue: string): string {
    const value = process.env[key];
    return (value === undefined || value === "") ? defaultValue : value;
}

export const config = {
    port: parseInt(getEnv("PORT", "3000"), 10),
    corsOrigin: getEnv("CORS_ORIGIN", "*"),
    isDev: getEnv("NODE_ENV", "development") === "development",

    dbPath: getEnv("DB_PATH", path.resolve(__dirname, "../inventory.db")),

    jwtSecret: getEnvOrThrow("JWT_SECRET"),

    adminInitUser: getEnvOrThrow("ADMIN_USER"),
    adminInitPass: getEnvOrThrow("ADMIN_PASS")
};
