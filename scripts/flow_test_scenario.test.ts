/**
 * Parts API Integration Test
 * * サーバー実装に基づき、/api/parts エンドポイントをテストします。
 * * 認証が必要なため、最初にログイン処理を行います。
 * 前提: サーバーが http://localhost:3000 で起動していること
 */
import {config} from "../src/config";

const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000/api";

// テスト用アカウント情報
// 環境変数か、デフォルト値を使用します。実際の環境に合わせて変更してください。
const TEST_USER = config.adminInitUser;
const TEST_PASS = config.adminInitPass;

// APIのレスポンス型定義 (サーバー実装に合わせて調整)
interface Part {
    sku: string;
    name: string;
    category: string;
    mpn?: string;
    package_code?: string;
    description?: string;
    quantity?: number; // サーバー実装にはないが、将来的に必要かも？今回は検証から外します
    price?: number;
    spec_definition?: any;
    suppliers?: any[];
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
    suppliers?: Array<{
        supplier_name: string;
        supplier_code: string;
        product_url: string;
    }>;
}

interface LoginResponse {
    token: string;
}

interface CreateResponse {
    message: string;
}

describe('Parts API Integration Test (Real HTTP Requests)', () => {
    // テスト間で共有する変数
    let targetSku: string | null = null;
    let authToken: string | null = null;

    // テストデータ: SKUをユニークにするため動的に生成
    const timestamp = Date.now();
    const testSku = `TEST-TR-${timestamp}`;

    const newPartData: CreatePartRequest = {
        sku: testSku,
        category: 'Semiconductors',
        name: 'High-Speed Test Transistor',
        mpn: `MPN-${timestamp}`,
        package_code: 'TO-92',
        unit: 'pcs',
        spec_definition: {
            "v_ceo": "50V",
            "i_c": "150mA"
        },
        suppliers: [
            {
                supplier_name: "Test Supplier Inc.",
                supplier_code: `S-${timestamp}`,
                product_url: "http://example.com/part"
            }
        ]
    };

    /**
     * 0. ログイン (認証トークン取得)
     */
    test('POST /auth/login - 認証トークンを取得できること', async () => {
        const response = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: TEST_USER, password: TEST_PASS }),
        });

        if (response.status !== 200) {
            const errorText = await response.text();
            throw new Error(`ログイン失敗 (${response.status}): ${errorText}`);
        }

        expect(response.status).toBe(200);

        const body = (await response.json()) as LoginResponse;
        expect(body).toHaveProperty('token');
        authToken = body.token;

        console.log('[Test] Logged in successfully.');
    });

    /**
     * 1. 部品作成 (POST)
     * 実装: createPart
     */
    test('POST /parts - 新規部品を作成できること', async () => {
        if (!authToken) throw new Error('Setup failed: No auth token');

        const response = await fetch(`${BASE_URL}/parts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(newPartData),
        });

        if (response.status !== 201) {
            const errorBody = await response.text();
            console.error(`[POST /parts Error] Status: ${response.status}, Body: ${errorBody}`);
        }

        expect(response.status).toBe(201);

        // サーバー実装では { message: "Part created successfully" } が返る
        const body = (await response.json()) as CreateResponse;
        expect(body.message).toBe("Part created successfully");

        // POSTのレスポンスにはIDが含まれないため、送信したSKUを保存して後続のテストで使用
        targetSku = newPartData.sku;
        console.log(`[Test] Created Part SKU: ${targetSku}`);
    });

    /**
     * 2. 部品一覧検索 (GET List)
     * 実装: getParts (keyword検索のテスト)
     */
    test('GET /parts?q=sku - 作成した部品を検索で見つけられること', async () => {
        if (!targetSku) throw new Error('Setup failed: No part created');
        if (!authToken) throw new Error('Setup failed: No auth token');

        // 作成したSKUで検索
        const response = await fetch(`${BASE_URL}/parts?q=${targetSku}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
        });

        expect(response.status).toBe(200);

        const parts = (await response.json()) as Part[];
        expect(Array.isArray(parts)).toBe(true);
        expect(parts.length).toBeGreaterThan(0);

        // 検索結果に作成した部品が含まれているか確認
        const foundPart = parts.find(p => p.sku === targetSku);
        expect(foundPart).toBeDefined();
        expect(foundPart?.name).toBe(newPartData.name);
    });

    /**
     * 3. 部品詳細取得 (GET Detail)
     * 実装: getPartBySku
     */
    test('GET /parts/:sku - SKU指定で詳細情報を取得できること', async () => {
        if (!targetSku) throw new Error('Setup failed: No part created');
        if (!authToken) throw new Error('Setup failed: No auth token');

        const response = await fetch(`${BASE_URL}/parts/${targetSku}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
        });

        if (response.status !== 200) {
            console.error(`[GET /parts/:sku Error] Status: ${response.status}, Body: ${await response.text()}`);
        }

        expect(response.status).toBe(200);
        const body = (await response.json()) as Part;

        expect(body.sku).toBe(targetSku);
        expect(body.name).toBe(newPartData.name);

        // サプライヤー情報も取得できているか確認 (LEFT JOINの結果)
        expect(body.suppliers).toBeDefined();
        expect(Array.isArray(body.suppliers)).toBe(true);
        if (body.suppliers && body.suppliers.length > 0) {
            expect(body.suppliers[0].supplier_name).toBe(newPartData.suppliers![0].supplier_name);
        }
    });

    /**
     * 4. 部品情報更新 (PATCH)
     * 実装: updatePart
     */
    test('PATCH /parts/:sku - 部品情報を更新できること', async () => {
        if (!targetSku) throw new Error('Setup failed: No part created');
        if (!authToken) throw new Error('Setup failed: No auth token');

        const updateData = {
            name: "Updated Transistor Name",
            spec_definition: {
                "v_ceo": "60V", // 仕様変更
                "i_c": "200mA"
            }
        };

        const response = await fetch(`${BASE_URL}/parts/${targetSku}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(updateData),
        });

        if (response.status !== 200) {
            console.error(`[PATCH /parts/:sku Error] Status: ${response.status}, Body: ${await response.text()}`);
        }
        expect(response.status).toBe(200);

        // 更新内容が反映されているか確認するため再取得
        const verifyResponse = await fetch(`${BASE_URL}/parts/${targetSku}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });

        const body = (await verifyResponse.json()) as Part;
        expect(body.name).toBe(updateData.name);
        expect(body.spec_definition.v_ceo).toBe("60V");
    });

    /**
     * 5. 部品削除 (DELETE)
     * 実装: deletePart
     */
    test('DELETE /parts/:sku - 部品を削除できること', async () => {
        if (!targetSku) throw new Error('Setup failed: No part created');
        if (!authToken) throw new Error('Setup failed: No auth token');

        const response = await fetch(`${BASE_URL}/parts/${targetSku}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
        });

        if (![200, 204].includes(response.status)) {
            console.error(`[DELETE /parts/:sku Error] Status: ${response.status}, Body: ${await response.text()}`);
        }

        // 204 No Content または 200 OK
        expect([200, 204]).toContain(response.status);
    });

    /**
     * 6. 削除確認 (GET -> 404)
     */
    test('GET /parts/:sku - 削除後は404が返ること', async () => {
        if (!targetSku) throw new Error('Setup failed: No part created');
        if (!authToken) throw new Error('Setup failed: No auth token');

        const response = await fetch(`${BASE_URL}/parts/${targetSku}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
        });

        expect(response.status).toBe(404);
    });
});
