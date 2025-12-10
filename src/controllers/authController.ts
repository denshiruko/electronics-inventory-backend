import {Request, Response} from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import {config} from "../config";
import {dbAsync} from "../database";

export async function login(req: Request, res: Response) {
    try {
        const {username, password} = req.body;

        if (!username || !password) {
            return res.status(400).json({error: "Username and password are required"});
        }

        const user = await dbAsync.get("SELECT * FROM users WHERE username = ?", [username]);

        if (!user) {
            return res.status(401).json({error: "Invalid username or password"});
        }

        const match = await bcrypt.compare(password, user.password_hash);

        if (!match) {
            return res.status(401).json({error: "Invalid username or password"});
        }

        const payload = {
            id: user.id,
            username: user.username,
            role: user.role
        };
        const token = jwt.sign(payload, config.jwtSecret, {expiresIn: "12h"});

        res.json({
            success: true,
            token,
            user: payload
        });

    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({error: "Internal Server Error"});
    }
}

export function getMe(req: Request, res: Response) {
    res.json({user: req.user});
}
