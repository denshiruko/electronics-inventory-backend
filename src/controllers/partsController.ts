import {Request, Response} from "express";
import {dbAsync} from "../database";

export async function getParts(req: Request, res: Response) {
    try {
        const {name, sku, supplier_code, package_code, category, description, q} = req.query;

        let sql = `
            SELECT DISTINCT p.*, i.id as inventory_id, i.location_code, i.quantity, i.condition, i.spec_value
            FROM parts_catalog p
                     LEFT JOIN inventory i ON p.sku = i.part_sku
                     LEFT JOIN part_suppliers s ON p.sku = s.part_sku
            WHERE true
        `;
        const params: any[] = [];

        if (name) {
            sql += " AND p.name LIKE ?";
            params.push(`%${name}%`);
        }

        if (sku) {
            sql += " AND p.sku LIKE ?";
            params.push(`%${sku}%`);
        }

        if (supplier_code) {
            sql += " AND s.supplier_code = ?";
            params.push(supplier_code);
        }

        const toArray = (val: any) => {
            if (Array.isArray(val)) return val;
            return String(val).split(",").map((v) => v.trim()).filter(v => v);
        };

        if (package_code) {
            const packages = toArray(package_code);
            if (packages.length > 0) {
                const placeholder = packages.map(() => "?").join(" OR p.package_code = ");
                sql += ` AND (p.package_code = ${placeholder})`;
                params.push(...packages);
            }
        }

        if (category) {
            const categories = toArray(category);
            if (categories.length > 0) {
                const placeholders = categories.map(() => "?").join(" OR p.category = ");
                sql += ` AND (p.category = ${placeholders})`;
                params.push(...categories);
            }
        }

        if (description) {
            const words = String(description).split(/[\s　]+/).filter(w => w);
            for (const word of words) {
                sql += " AND p.description LIKE ?";
                params.push(`%${word}%`);
            }
        }

        if (q) {
            sql += " AND (p.sku LIKE ? OR p.name LIKE ?)";
            const keyword = `%${q}%`;
            params.push(keyword, keyword);
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

        await dbAsync.run("BEGIN TRANSACTION");

        try {
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

            await dbAsync.run("COMMIT");

            res.json({
                success: true,
                message: "Cut operation successful",
                original_id: inventoryId,
                remaining_spec: remainingSpec
            });
        } catch (err) {
            await dbAsync.run("ROLLBACK");
            throw err;
        }
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
