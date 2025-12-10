import {Router} from "express";
import {createPart, cutInventory, deletePart, getPartBySku, getParts, updatePart} from "../controllers/partsController";
import {authenticateToken, requireAdmin} from "../middleware/authMiddleware";

const router = Router();

router.use(authenticateToken);

router.get("/", getParts);

router.get("/:sku", getPartBySku);

router.post("/", requireAdmin, createPart);

router.patch("/:sku", requireAdmin, updatePart);

router.delete("/:sku", requireAdmin, deletePart);

router.post("/cut", cutInventory);

export default router;
