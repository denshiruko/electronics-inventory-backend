import express, {Request, Response} from "express";
import cors from "cors";
import helmet from "helmet";

import {config} from "./config";
import "./database";
import authRoutes from "./routes/authRoutes";
import partsRoutes from "./routes/partsRoutes";

const app = express();

app.use(helmet());
app.use(cors({
    origin: config.corsOrigin
}));
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/parts", partsRoutes);

app.get("/", (_req: Request, res: Response) => {
    res.json({
        status: "ok",
        message: "Electronics Inventory Management API",
        timestamp: new Date().toISOString()
    });
});

app.use((_req: Request, res: Response) => {
    res.status(404).json({error: "Not Found"});
});

app.use((err: Error, _req: Request, res: Response) => {
    console.error(err.stack);
    res.status(500).json({
        error: "Internal Server Error",
        message: config.isDev ? err.message : undefined
    });
});

app.listen(config.port, "0.0.0.0", () => {
    console.log(`Server running on port ${config.port}`);
    console.log(`Environment: ${config.isDev ? "Development" : "Production"}`);
});
