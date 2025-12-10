import {NextFunction, Request, Response} from "express";
import jwt from "jsonwebtoken";
import {config} from "../config";
import {UserPayload} from "../types/express";

export function authenticateToken(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({error: "Access token required"});
    }

    jwt.verify(token, config.jwtSecret, (err, user) => {
        if (err) {
            return res.status(403).json({error: "Invalid access token"});
        }
        req.user = user as UserPayload;
        next();
    });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (req.user?.role !== "admin") {
        return res.status(403).json({error: "Admin privileges required"});
    }
    next();
}
