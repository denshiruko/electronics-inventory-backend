/**
 * Parts API Integration Test
 * * サーバー実装に基づき、/api/parts エンドポイントをテストします。
 * * 認証、CRUD、詳細な検索機能、在庫操作を検証します。
 * 前提: サーバーが http://localhost:3000 で起動していること
 */
import {config} from "../src/config";

const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000/api";

// テスト用アカウント情報
const TEST_USER = config.adminInitUser;
const TEST_PASS = config.adminInitPass;

// APIのレスポンス型定義
interface Part {
    sku: string;
    name: string;
    category: string;
    mpn?: string;
    package_code?: string;
    description?: string;
    quantity?: number;
    spec_value?: number;
    suppliers?: Array<{
        supplier_name: string;
        supplier_code: string;
        product_url: string;
    }>;
}

// 作成用リクエストボディ
interface CreatePartRequest {
    sku: string;
    name: string;
    category: string;
    mpn?: string;
    package_code?: string;
    spec_definition?: Record<string, any>;
    image_url?: string;
    default_spec?: number;
    unit?: string;
    description?: string;
    suppliers?: Array<{
        supplier_name: string;
        supplier_code: string;
        product_url: string;
    }>;
}

interface LoginResponse {
    token: string;
}

describe("Parts API Integration Test (Full Coverage)", () => {
    // テスト間で共有する変数
    let targetSku: string | null = null;
    let authToken: string | null = null;

    const timestamp = Date.now();
    const testSku = `TEST-IC-${timestamp}`;
    const supplierCode = `SUP-${timestamp}`;

    const newPartData: CreatePartRequest = {
        sku: testSku,
        category: "IC",
        name: "Dual OpAmp Low Noise",
        mpn: `MPN-${timestamp}`,
        package_code: "DIP8",
        unit: "pcs",
        // 注意: descriptionカラムがparts_catalogに存在するか確認が必要ですが、
        // コントローラーの実装には `p.description` があるため、ここには含めません（DB定義上TEXTカラムがある前提、またはspec_definition等で代用）
        // 今回のコントローラー実装を見る限り、SQLで `p.description` を参照しているので、
        // 本来は createPart で description を保存する必要があります。
        // createPartの実装には description が含まれていないため、
        // 厳密には description 検索のテストは "データが入っていないためヒットしない" 結果になる可能性があります。
        // ここではフローの確認を優先します。
        suppliers: [
            {
                supplier_name: "Test Supplier Inc.",
                supplier_code: supplierCode, // 検索テスト用: サプライヤーコード
                product_url: "http://example.com/part"
            }
        ]
    };

    /**
     * 1. 認証 (Login)
     */
    test("POST /auth/login - 認証トークンを取得できること", async () => {
        const response = await fetch(`${BASE_URL}/auth/login`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({username: TEST_USER, password: TEST_PASS})
        });

        if (response.status !== 200) {
            const errorText = await response.text();
            throw new Error(`ログイン失敗 (${response.status}): ${errorText}`);
        }

        expect(response.status).toBe(200);
        const body = (await response.json()) as LoginResponse;
        expect(body).toHaveProperty("token");
        authToken = body.token;
    });

    /**
     * 2. 部品作成 (Create)
     */
    test("POST /parts - 新規部品を作成できること", async () => {
        if (!authToken) throw new Error("No auth token");

        const response = await fetch(`${BASE_URL}/parts`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${authToken}`
            },
            body: JSON.stringify(newPartData)
        });

        if (response.status !== 201) {
            console.error(`Create Error: ${await response.text()}`);
        }
        expect(response.status).toBe(201);
        targetSku = newPartData.sku;
    });

    /**
     * 3. 検索機能のテスト (Search)
     */
    describe("検索機能の検証", () => {
        const headers = () => ({
            "Content-Type": "application/json",
            "Authorization": `Bearer ${authToken}`
        });

        test("検索: 部品名 (部分一致) - \"OpAmp\" でヒットすること", async () => {
            const qs = new URLSearchParams({name: "OpAmp"}).toString();
            const response = await fetch(`${BASE_URL}/parts?${qs}`, {headers: headers()});
            expect(response.status).toBe(200);
            const parts = (await response.json()) as Part[];
            const found = parts.find(p => p.sku === targetSku);
            expect(found).toBeDefined();
        });

        test("検索: SKU (部分一致) - SKUの一部でヒットすること", async () => {
            const qs = new URLSearchParams({sku: "TEST-IC"}).toString();
            const response = await fetch(`${BASE_URL}/parts?${qs}`, {headers: headers()});
            expect(response.status).toBe(200);
            const parts = (await response.json()) as Part[];
            const found = parts.find(p => p.sku === targetSku);
            expect(found).toBeDefined();
        });

        test("検索: サプライヤーコード (完全一致) - 指定コードでヒットすること", async () => {
            const qs = new URLSearchParams({supplier_code: supplierCode}).toString();
            const response = await fetch(`${BASE_URL}/parts?${qs}`, {headers: headers()});
            expect(response.status).toBe(200);
            const parts = (await response.json()) as Part[];
            // サプライヤー検索の場合、レスポンス構造が少し異なる場合があるので注意（コントローラー実装依存）
            // 実装では: SELECT p.name, p.sku ... FROM ... WHERE s.supplier_code = ?
            const found = parts.find(p => p.sku === targetSku);
            expect(found).toBeDefined();
        });

        test("検索: パッケージ (OR条件) - \"DIP8, SOP8\" でヒットすること", async () => {
            // DIP8 (対象) と SOP8 (ダミー) を指定
            const qs = new URLSearchParams({package_code: "SOP8, DIP8"}).toString();
            const response = await fetch(`${BASE_URL}/parts?${qs}`, {headers: headers()});
            expect(response.status).toBe(200);
            const parts = (await response.json()) as Part[];
            const found = parts.find(p => p.sku === targetSku);
            expect(found).toBeDefined();
            // パッケージ違いでフィルタ除外されるか確認
            const qs2 = new URLSearchParams({package_code: "SOP8"}).toString();
            const res2 = await fetch(`${BASE_URL}/parts?${qs2}`, {headers: headers()});
            const parts2 = (await res2.json()) as Part[];
            expect(parts2.find(p => p.sku === targetSku)).toBeUndefined();
        });

        test("検索: カテゴリ (OR条件) - \"IC\" でヒットすること", async () => {
            const qs = new URLSearchParams({category: "IC"}).toString();
            const response = await fetch(`${BASE_URL}/parts?${qs}`, {headers: headers()});
            expect(response.status).toBe(200);
            const parts = (await response.json()) as Part[];
            expect(parts.find(p => p.sku === targetSku)).toBeDefined();
        });

        test("検索: 複合条件 (AND) - カテゴリとパッケージで絞り込み", async () => {
            const qs = new URLSearchParams({
                category: "IC",
                package_code: "DIP8"
            }).toString();
            const response = await fetch(`${BASE_URL}/parts?${qs}`, {headers: headers()});
            expect(response.status).toBe(200);
            const parts = (await response.json()) as Part[];
            expect(parts.find(p => p.sku === targetSku)).toBeDefined();
        });
    });

    /**
     * 4. 詳細取得 (Get Detail)
     */
    test("GET /parts/:sku - 詳細情報を取得し、サプライヤー情報が含まれること", async () => {
        const response = await fetch(`${BASE_URL}/parts/${targetSku}`, {
            method: "GET",
            headers: {"Authorization": `Bearer ${authToken}`}
        });

        expect(response.status).toBe(200);
        const body = (await response.json()) as Part;
        expect(body.sku).toBe(targetSku);
        expect(body.suppliers).toBeDefined();
        expect(body.suppliers![0].supplier_code).toBe(supplierCode);
    });

    /**
     * 5. 在庫切断機能 (Cut Inventory)
     * 注意: 現在のAPIには「在庫を追加する(Add Inventory)」機能がないため、
     * 有効な inventoryId を取得できません。
     * そのため、適当なIDを送信し、「404 Not Found」が返ることで
     * エンドポイントの存在とエラーハンドリングを検証します。
     */
    test("POST /parts/cut - 存在しない在庫IDで404が返ること (エンドポイント到達確認)", async () => {
        const dummyInventoryId = 999999;
        const response = await fetch(`${BASE_URL}/parts/cut`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${authToken}`
            },
            body: JSON.stringify({
                inventoryId: dummyInventoryId,
                useAmount: 1
            })
        });

        // インベントリが存在しないため 404 が期待される
        // (もし在庫があれば、トランザクション処理が走り 200 になる)
        if (response.status !== 404) {
            console.log(`Cut response: ${response.status}`, await response.json());
        }
        expect(response.status).toBe(404);
    });

    /**
     * 6. 更新 (Update)
     */
    test("PATCH /parts/:sku - 部品情報を更新できること", async () => {
        const updateData = {
            name: "Updated OpAmp Name",
            package_code: "SOP8" // パッケージを変更してみる
        };

        const response = await fetch(`${BASE_URL}/parts/${targetSku}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${authToken}`
            },
            body: JSON.stringify(updateData)
        });

        expect(response.status).toBe(200);

        // 変更の確認
        const checkRes = await fetch(`${BASE_URL}/parts/${targetSku}`, {
            headers: {"Authorization": `Bearer ${authToken}`}
        });
        const body = await checkRes.json();
        expect(body.name).toBe(updateData.name);
        expect(body.package_code).toBe(updateData.package_code);
    });

    /**
     * 7. 削除 (Delete)
     */
    test("DELETE /parts/:sku - 部品を削除できること", async () => {
        const response = await fetch(`${BASE_URL}/parts/${targetSku}`, {
            method: "DELETE",
            headers: {"Authorization": `Bearer ${authToken}`}
        });
        expect([200, 204]).toContain(response.status);

        // 削除後の確認
        const checkRes = await fetch(`${BASE_URL}/parts/${targetSku}`, {
            headers: {"Authorization": `Bearer ${authToken}`}
        });
        expect(checkRes.status).toBe(404);
    });
});
