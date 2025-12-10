import {Request, Response} from "express";
import {dbAsync} from "../database";

export async function getParts(req: Request, res: Response) {
    try {
        const {category, package_code, supplier_code} = req.query;

        if (supplier_code) {
            const sql = `
                SELECT p.name, p.sku, i.location_code, i.quantity, i.condition
                FROM parts_catalog p
                         JOIN part_suppliers s ON p.sku = s.part_sku
                         LEFT JOIN inventory i ON p.sku = i.part_sku
                WHERE s.supplier_code = ?
            `;
            const parts = await dbAsync.all(sql, [supplier_code]);
            return res.json(parts);
        }

        let sql = `
            SELECT i.*, p.name, p.category, p.package_code, p.default_spec, p.unit
            FROM inventory i
                     JOIN parts_catalog p ON i.part_sku = p.sku
            WHERE i.quantity > 0
        `;
        const params: any[] = [];

        if (category) {
            sql += " AND p.category = ?";
            params.push(category);
        }
        if (package_code) {
            sql += " AND p.package_code = ?";
            params.push(package_code);
        }

        const parts = await dbAsync.all(sql, params);
        res.json(parts);
    } catch (err) {
        console.error("Error fetching parts:", err);
        res.status(500).json({error: "Internal Server Error"});
    }
}

export async function cutInventory(req: Request, res: Response) {
    try {
        const {inventoryId, useAmount} = req.body;

        if (!inventoryId || !useAmount) {
            return res.status(400).json({error: "Inventory ID and use amount are required"});
        }

        const item = await dbAsync.get(`
            SELECT i.*, p.default_spec
            FROM inventory i
                     JOIN parts_catalog p ON i.part_sku = p.sku
            WHERE i.id = ?
        `, [inventoryId]);

        if (!item) {
            return res.status(404).json({error: "Inventory item not found"});
        }

        if (item.quantity < 1) {
            return res.status(400).json({error: "Insufficient quantity"});
        }

        const currentSpec = item.condition === "NEW" ? item.default_spec : item.spec_value;
        const remainingSpec = currentSpec - useAmount;

        if (remainingSpec < 0) {
            return res.status(400).json({error: "Use amount exceeds current spec"});
        }

        await dbAsync.run(`
            UPDATE inventory
            SET quantity     = quantity - 1,
                last_updated = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [inventoryId]);

        if (remainingSpec > 0) {
            await dbAsync.run(`
                INSERT INTO inventory (part_sku, location_code, quantity, spec_value, condition)
                VALUES (?, ?, 1, ?, 'SCRAP')
            `, [item.part_sku, item.location_code, remainingSpec]);
        }

        res.json({
            success: true,
            message: "Cut operation successful",
            original_id: inventoryId,
            remaining_spec: remainingSpec
        });

    } catch (err) {
        console.error("Cut operation error:", err);
        res.status(500).json({error: "Internal Server Error"});
    }
}

export async function getPartBySku(req: Request, res: Response) {
    try {
        const {sku} = req.params;

        const part = await dbAsync.get("SELECT * FROM parts_catalog WHERE sku = ?", [sku]);
        if (!part) {
            return res.status(404).json({error: "Part not found"});
        }

        const suppliers = await dbAsync.all("SELECT * FROM part_suppliers WHERE part_sku = ?", [sku]);

        res.json({
            ...part,
            spec_definition: part.spec_definition ? JSON.parse(part.spec_definition) : {},
            suppliers
        });
    } catch (err) {
        console.error("Error fetching part details:", err);
        res.status(500).json({error: "Internal Server Error"});
    }
}

export async function createPart(req: Request, res: Response) {
    try {
        const {
            sku, category, name, mpn, package_code,
            spec_definition, image_url, default_spec, unit,
            suppliers
        } = req.body;

        if (!sku || !category || !name) {
            return res.status(400).json({error: "SKU, category, and name are required"});
        }

        const existing = await dbAsync.get("SELECT sku FROM parts_catalog WHERE sku = ?", [sku]);
        if (existing) {
            return res.status(409).json({error: "Part with this SKU already exists"});
        }

        await dbAsync.run("BEGIN TRANSACTION");

        try {
            await dbAsync.run(`
                INSERT INTO parts_catalog (sku, category, name, mpn, package_code,
                                           spec_definition, image_url, default_spec, unit)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                sku, category, name, mpn || null, package_code || null,
                JSON.stringify(spec_definition || {}), image_url || null,
                default_spec || 0, unit || "pcs"
            ]);

            if (Array.isArray(suppliers) && suppliers.length > 0) {
                for (const supplier of suppliers) {
                    await dbAsync.run(`
                        INSERT INTO part_suppliers (part_sku, supplier_name, supplier_code, product_url)
                        VALUES (?, ?, ?, ?)`, [
                        sku,
                        supplier.supplier_name,
                        supplier.supplier_code,
                        supplier.product_url
                    ]);
                }
            }

            await dbAsync.run("COMMIT");
            res.status(201).json({message: "Part created successfully"});
        } catch (err) {
            await dbAsync.run("ROLLBACK");
            throw err;
        }
    } catch (err) {
        console.error("Error creating part:", err);
        res.status(500).json({error: "Internal Server Error"});
    }
}

export async function updatePart(req: Request, res: Response) {
    try {
        const {sku} = req.params;
        const {
            name,
            category,
            mpn,
            package_code,
            spec_definition,
            image_url,
            default_spec,
            unit,
            suppliers
        } = req.body;

        const existing = await dbAsync.get("SELECT sku FROM parts_catalog WHERE sku = ?", [sku]);

        if (!existing) {
            return res.status(404).json({error: "Part not found"});
        }

        await dbAsync.run("BEGIN TRANSACTION");

        try {
            await dbAsync.run(`
                UPDATE parts_catalog
                SET name            = coalesce(?, name),
                    category        = coalesce(?, category),
                    mpn             = coalesce(?, mpn),
                    package_code    = coalesce(?, package_code),
                    spec_definition = coalesce(?, spec_definition),
                    image_url       = coalesce(?, image_url),
                    default_spec    = coalesce(?, default_spec),
                    unit            = coalesce(?, unit)
                WHERE sku = ?`, [
                name, category, mpn, package_code,
                spec_definition ? JSON.stringify(spec_definition) : null,
                image_url, default_spec, unit, sku
            ]);

            if (Array.isArray(suppliers)) {
                await dbAsync.run("DELETE FROM part_suppliers WHERE part_sku = ?", [sku]);

                for (const supplier of suppliers) {
                    await dbAsync.run(`
                        INSERT INTO part_suppliers (part_sku, supplier_name, supplier_code, product_url)
                        VALUES (?, ?, ?,
                                ?)`, [sku, supplier.supplier_name, supplier.supplier_code, supplier.product_url]);
                }
            }

            await dbAsync.run("COMMIT");
            res.json({message: "Part updated successfully"});
        } catch (err) {
            await dbAsync.run("ROLLBACK");
            throw err;
        }
    } catch (err) {
        console.error("Error updating part:", err);
        res.status(500).json({error: "Internal Server Error"});
    }
}

export async function deletePart(req: Request, res: Response) {
    try {
        const {sku} = req.params;

        const existing = await dbAsync.get("SELECT sku FROM parts_catalog WHERE sku = ?", [sku]);
        if (!existing) {
            return res.status(404).json({error: "Part not found"});
        }

        await dbAsync.run("BEGIN TRANSACTION");
        try {
            await dbAsync.run("DELETE FROM part_suppliers WHERE part_sku = ?", [sku]);
            await dbAsync.run("DELETE FROM parts_catalog WHERE sku = ?", [sku]);

            await dbAsync.run("COMMIT");
            res.status(204).send();
        } catch (err) {
            await dbAsync.run("ROLLBACK");
            throw err;
        }
    } catch (err) {
        console.error("Error deleting part:", err);
        res.status(500).json({error: "Internal Server Error"});
    }
}
