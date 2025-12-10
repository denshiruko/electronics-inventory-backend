import sqlite3 from "sqlite3";
import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config();

const sqlite = sqlite3.verbose();

const dbPath = process.env.DB_PATH || "./inventory.db";

const db = new sqlite.Database(dbPath, (err) => {
    if (err) {
        console.error(`Error connecting to database at ${dbPath}: ${err.message}`);
    } else {
        console.log(`Connected to database at ${dbPath}`);
        initDb();
    }
});

function initDb(): void {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users
                (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    username      TEXT UNIQUE NOT NULL,
                    password_hash TEXT        NOT NULL,
                    role          TEXT     DEFAULT 'user',
                    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, (err) => {
            if (!err) {
                createDefaultAdmin();
            }
        });

        db.run(`CREATE TABLE IF NOT EXISTS parts_catalog
                (
                    sku             TEXT PRIMARY KEY,
                    category        TEXT NOT NULL,
                    name            TEXT NOT NULL,
                    mpn             TEXT,
                    package_code    TEXT,
                    spec_definition TEXT,
                    image_url       TEXT,
                    default_spec    REAL,
                    unit            TEXT,
                    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);

        db.run(`CREATE TABLE IF NOT EXISTS part_suppliers
                (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    part_sku      TEXT NOT NULL,
                    supplier_code TEXT,
                    supplier_name TEXT,
                    product_url   TEXT,
                    FOREIGN KEY (part_sku) REFERENCES parts_catalog (sku) ON DELETE CASCADE
                )`);

        db.run(`CREATE TABLE IF NOT EXISTS locations
                (
                    code        TEXT PRIMARY KEY,
                    type        TEXT,
                    description TEXT
                )`);

        db.run(`CREATE TABLE IF NOT EXISTS inventory
                (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    part_sku      TEXT NOT NULL,
                    location_code TEXT NOT NULL,
                    quantity      REAL NOT NULL,
                    spec_value    REAL NOT NULL,
                    condition     TEXT CHECK (condition IN ('NEW', 'SCRAP')),
                    last_updated  DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (part_sku) REFERENCES parts_catalog (sku),
                    FOREIGN KEY (location_code) REFERENCES locations (code)
                )`);

        console.log("Database initialized");
    });
}

function createDefaultAdmin(): void {
    const defaultUser = "admin";
    const defaultPass = "admin123";

    db.get(`SELECT id
            FROM users
            WHERE username = ?`, [defaultUser], (err, row) => {
        if (err) {
            console.error(err);
            return;
        }
        if (!row) {
            const saltRounds = 10;
            bcrypt.hash(defaultPass, saltRounds, (err, hash) => {
                if (err) {
                    console.error(err);
                    return;
                }
                if (hash) {
                    db.run(`INSERT INTO users (username, password_hash, role)
                            VALUES (?, ?, ?)`, [defaultUser, hash, "admin"], (err) => {
                        if (err) {
                            console.error(err);
                        } else {
                            console.log(`Default admin user created. (User: ${defaultUser}, Pass: ${defaultPass})`);
                        }
                    });
                }
            });
        }
    });
}
